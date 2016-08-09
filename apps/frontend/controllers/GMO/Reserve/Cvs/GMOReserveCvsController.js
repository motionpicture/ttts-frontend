"use strict";
const ReserveBaseController_1 = require('../../../ReserveBaseController');
const GMOUtil_1 = require('../../../../../common/Util/GMO/GMOUtil');
const Models_1 = require('../../../../../common/models/Models');
const ReservationUtil_1 = require('../../../../../common/models/Reservation/ReservationUtil');
const GMONotificationResponseModel_1 = require('../../../../models/Reserve/GMONotificationResponseModel');
const crypto = require('crypto');
const conf = require('config');
class GMOReserveCvsController extends ReserveBaseController_1.default {
    /**
     * GMOからの結果受信
     */
    result(gmoResultModel) {
        // 決済待ちステータスへ変更
        let update = {
            gmo_shop_id: gmoResultModel.ShopID,
            gmo_amount: gmoResultModel.Amount,
            gmo_tax: gmoResultModel.Tax,
            gmo_cvs_code: gmoResultModel.CvsCode,
            gmo_cvs_conf_no: gmoResultModel.CvsConfNo,
            gmo_cvs_receipt_no: gmoResultModel.CvsReceiptNo,
            gmo_cvs_receipt_url: gmoResultModel.CvsReceiptUrl
        };
        // 内容の整合性チェック
        this.logger.info('finding reservations...payment_no:', gmoResultModel.OrderID);
        Models_1.default.Reservation.find({
            payment_no: gmoResultModel.OrderID,
            status: { $in: [ReservationUtil_1.default.STATUS_TEMPORARY, ReservationUtil_1.default.STATUS_WAITING_SETTLEMENT] }
        }, '_id total_charge purchaser_group', (err, reservationDocuments) => {
            this.logger.info('reservations found.', err, reservationDocuments.length);
            if (err) {
                return this.next(new Error('unexpected error.'));
            }
            if (reservationDocuments.length < 1) {
                return this.next(new Error(this.req.__('Message.UnexpectedError')));
            }
            // 利用金額の整合性
            this.logger.info('Amount must be ', reservationDocuments[0].get('total_charge'));
            if (parseInt(gmoResultModel.Amount) !== reservationDocuments[0].get('total_charge')) {
                return this.next(new Error(this.req.__('Message.UnexpectedError')));
            }
            // チェック文字列
            // 8 ＋ 23 ＋ 24 ＋ 25 ＋ 39 + 14 ＋ショップパスワード
            let md5hash = crypto.createHash('md5');
            md5hash.update(`${gmoResultModel.OrderID}${gmoResultModel.CvsCode}${gmoResultModel.CvsConfNo}${gmoResultModel.CvsReceiptNo}${gmoResultModel.PaymentTerm}${gmoResultModel.TranDate}${conf.get('gmo_payment_shop_password')}`, 'utf8');
            let checkString = md5hash.digest('hex');
            this.logger.info('CheckString must be ', checkString);
            if (checkString !== gmoResultModel.CheckString) {
                return this.next(new Error(this.req.__('Message.UnexpectedError')));
            }
            let reservationIds = reservationDocuments.map((reservationDocument) => {
                return reservationDocument.get('_id');
            });
            this.logger.info('changing status to STATUS_WAITING_SETTLEMENT...update:', update);
            this.processChangeStatus2waitingSettlement(reservationIds, update, (err) => {
                if (err) {
                    // 売上取消したいところだが、結果通知も裏で動いているので、うかつにできない
                    this.next(new Error('failed in payment.'));
                }
                else {
                    this.logger.info('redirecting to waitingSettlement...');
                    // 購入者区分による振り分け
                    let group = reservationDocuments[0].get('purchaser_group');
                    switch (group) {
                        case ReservationUtil_1.default.PURCHASER_GROUP_MEMBER:
                            this.res.redirect(this.router.build('member.reserve.waitingSettlement', { paymentNo: gmoResultModel.OrderID }));
                            break;
                        default:
                            this.res.redirect(this.router.build('customer.reserve.waitingSettlement', { paymentNo: gmoResultModel.OrderID }));
                            break;
                    }
                }
            });
        });
    }
    /**
     * GMO結果通知受信
     */
    notify(gmoNotificationModel) {
        let paymentNo = gmoNotificationModel.OrderID;
        let update;
        switch (gmoNotificationModel.Status) {
            case GMOUtil_1.default.STATUS_CVS_PAYSUCCESS:
                update = {
                    gmo_status: gmoNotificationModel.Status
                };
                // 内容の整合性チェック
                this.logger.info('finding reservations...payment_no:', gmoNotificationModel.OrderID);
                Models_1.default.Reservation.find({
                    payment_no: gmoNotificationModel.OrderID,
                    status: ReservationUtil_1.default.STATUS_WAITING_SETTLEMENT
                }, '_id total_charge', (err, reservationDocuments) => {
                    this.logger.info('reservations found.', err, reservationDocuments.length);
                    if (err) {
                        return this.next(new Error('unexpected error.'));
                    }
                    if (reservationDocuments.length < 1) {
                        return this.next(new Error(this.req.__('Message.UnexpectedError')));
                    }
                    // 利用金額の整合性
                    this.logger.info('Amount must be ', reservationDocuments[0].get('total_charge'));
                    if (parseInt(gmoNotificationModel.Amount) !== reservationDocuments[0].get('total_charge')) {
                        return this.next(new Error(this.req.__('Message.UnexpectedError')));
                    }
                    let reservationIds = reservationDocuments.map((reservationDocument) => {
                        return reservationDocument.get('_id');
                    });
                    this.logger.info('fixing reservations... update:', update);
                    this.processFixReservations(paymentNo, reservationIds, update, (err) => {
                        if (err) {
                            // AccessPassが************なので、売上取消要求は行えない
                            // 失敗した場合、約60分毎に5回再通知されるので、それをリトライとみなす
                            this.logger.info('sending response RecvRes_NG...gmoNotificationModel.Status:', gmoNotificationModel.Status);
                            this.res.send(GMONotificationResponseModel_1.default.RecvRes_NG);
                        }
                        else {
                            this.logger.info('sending response RecvRes_OK...gmoNotificationModel.Status:', gmoNotificationModel.Status);
                            this.res.send(GMONotificationResponseModel_1.default.RecvRes_OK);
                        }
                    });
                });
                break;
            case GMOUtil_1.default.STATUS_CVS_REQSUCCESS:
                // 決済待ちステータスへ変更
                update = {
                    gmo_shop_id: gmoNotificationModel.ShopID,
                    gmo_amount: gmoNotificationModel.Amount,
                    gmo_tax: gmoNotificationModel.Tax,
                    gmo_cvs_code: gmoNotificationModel.CvsCode,
                    gmo_cvs_conf_no: gmoNotificationModel.CvsConfNo,
                    gmo_cvs_receipt_no: gmoNotificationModel.CvsReceiptNo
                };
                // 内容の整合性チェック
                this.logger.info('finding reservations...payment_no:', gmoNotificationModel.OrderID);
                Models_1.default.Reservation.find({
                    payment_no: gmoNotificationModel.OrderID,
                    status: { $in: [ReservationUtil_1.default.STATUS_TEMPORARY, ReservationUtil_1.default.STATUS_WAITING_SETTLEMENT] }
                }, '_id total_charge', (err, reservationDocuments) => {
                    this.logger.info('reservations found.', err, reservationDocuments.length);
                    if (err) {
                        return this.next(new Error('unexpected error.'));
                    }
                    if (reservationDocuments.length < 1) {
                        return this.next(new Error(this.req.__('Message.UnexpectedError')));
                    }
                    // 利用金額の整合性
                    this.logger.info('Amount must be ', reservationDocuments[0].get('total_charge'));
                    if (parseInt(gmoNotificationModel.Amount) !== reservationDocuments[0].get('total_charge')) {
                        return this.next(new Error(this.req.__('Message.UnexpectedError')));
                    }
                    let reservationIds = reservationDocuments.map((reservationDocument) => {
                        return reservationDocument.get('_id');
                    });
                    this.logger.info('changing status to STATUS_WAITING_SETTLEMENT...update:', update);
                    this.processChangeStatus2waitingSettlement(reservationIds, update, (err) => {
                        if (err) {
                            this.logger.info('sending response RecvRes_NG...');
                            this.res.send(GMONotificationResponseModel_1.default.RecvRes_NG);
                        }
                        else {
                            this.logger.info('sending response RecvRes_OK...');
                            this.res.send(GMONotificationResponseModel_1.default.RecvRes_OK);
                        }
                    });
                });
                break;
            case GMOUtil_1.default.STATUS_CVS_UNPROCESSED:
                this.res.send(GMONotificationResponseModel_1.default.RecvRes_OK);
                break;
            case GMOUtil_1.default.STATUS_CVS_PAYFAIL: // 決済失敗
            case GMOUtil_1.default.STATUS_CVS_EXPIRED: // 期限切れ
            case GMOUtil_1.default.STATUS_CVS_CANCEL:
                // 空席ステータスに戻す
                update = {
                    status: ReservationUtil_1.default.STATUS_AVAILABLE,
                    payment_no: null
                };
                let promises = [];
                this.logger.info('finding reservations...payment_no:', gmoNotificationModel.OrderID);
                Models_1.default.Reservation.find({
                    payment_no: gmoNotificationModel.OrderID,
                    status: ReservationUtil_1.default.STATUS_WAITING_SETTLEMENT
                }, '_id total_charge', (err, reservationDocuments) => {
                    this.logger.info('reservations found.', err, reservationDocuments.length);
                    if (err) {
                        this.logger.info('sending response RecvRes_NG...');
                        return this.res.send(GMONotificationResponseModel_1.default.RecvRes_NG);
                    }
                    if (reservationDocuments.length < 1) {
                        this.logger.info('sending response RecvRes_NG...');
                        return this.res.send(GMONotificationResponseModel_1.default.RecvRes_NG);
                    }
                    // 利用金額の整合性
                    this.logger.info('Amount must be ', reservationDocuments[0].get('total_charge'));
                    if (parseInt(gmoNotificationModel.Amount) !== reservationDocuments[0].get('total_charge')) {
                        this.logger.info('sending response RecvRes_NG...');
                        return this.res.send(GMONotificationResponseModel_1.default.RecvRes_NG);
                    }
                    for (let reservationDocument of reservationDocuments) {
                        promises.push(new Promise((resolve, reject) => {
                            this.logger.info('updating reservations...update:', update);
                            Models_1.default.Reservation.update({
                                _id: reservationDocument.get('_id')
                            }, update, (err, raw) => {
                                this.logger.info('reservation updated.', err, raw);
                                if (err) {
                                    reject();
                                }
                                else {
                                    resolve();
                                }
                            });
                        }));
                    }
                    ;
                    Promise.all(promises).then(() => {
                        this.logger.info('sending response RecvRes_OK...');
                        this.res.send(GMONotificationResponseModel_1.default.RecvRes_OK);
                    }, (err) => {
                        this.logger.info('sending response RecvRes_NG...');
                        this.res.send(GMONotificationResponseModel_1.default.RecvRes_NG);
                    });
                });
                break;
            default:
                this.res.send(GMONotificationResponseModel_1.default.RecvRes_NG);
                break;
        }
    }
    /**
     * 決済待ちステータスへ変更する
     *
     * @param {string[]} reservationIds 予約IDリスト
     * @param {Object} update 追加更新パラメータ
     */
    processChangeStatus2waitingSettlement(reservationIds, update, cb) {
        let promises = [];
        update['status'] = ReservationUtil_1.default.STATUS_WAITING_SETTLEMENT;
        update['updated_user'] = 'GMOReserveCsvController';
        // 決済待ちステータスへ変更
        for (let reservationId of reservationIds) {
            promises.push(new Promise((resolve, reject) => {
                this.logger.info('updating reservations...update:', update);
                Models_1.default.Reservation.update({
                    _id: reservationId
                }, update, (err, raw) => {
                    this.logger.info('reservation updated.', err, raw);
                    if (err) {
                        reject();
                    }
                    else {
                        resolve();
                    }
                });
            }));
        }
        ;
        Promise.all(promises).then(() => {
            cb(null);
        }, (err) => {
            cb(new Error('some reservations not updated.'));
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = GMOReserveCvsController;