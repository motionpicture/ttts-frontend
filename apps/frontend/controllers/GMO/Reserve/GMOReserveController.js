"use strict";
const ReserveBaseController_1 = require('../../ReserveBaseController');
const Util_1 = require('../../../../common/Util/Util');
const GMOUtil_1 = require('../../../../common/Util/GMO/GMOUtil');
const ReservationModel_1 = require('../../../models/Reserve/ReservationModel');
const GMOResultModel_1 = require('../../../models/Reserve/GMOResultModel');
const GMONotificationModel_1 = require('../../../models/Reserve/GMONotificationModel');
const GMONotificationResponseModel_1 = require('../../../models/Reserve/GMONotificationResponseModel');
const moment = require('moment');
const crypto = require('crypto');
const conf = require('config');
const GMOReserveCreditController_1 = require('./Credit/GMOReserveCreditController');
const GMOReserveCvsController_1 = require('./Cvs/GMOReserveCvsController');
class GMOReserveController extends ReserveBaseController_1.default {
    /**
     * GMO決済を開始する
     * TODO 仮実運用で確定
     */
    start() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }
            this.logger.debug('reservationModel is ', reservationModel.toLog());
            // 予約情報セッション削除
            this.logger.debug('removing reservationModel... ', reservationModel);
            reservationModel.remove(() => {
                if (err) {
                }
                else {
                    // ここで予約番号発行
                    reservationModel.paymentNo = Util_1.default.createPaymentNo();
                    // 予約プロセス固有のログファイルをセット
                    this.setProcessLogger(reservationModel.paymentNo, () => {
                        this.logger.info('paymentNo published. paymentNo:', reservationModel.paymentNo);
                        // GMOからの結果受信にそなえてセッションを新規に作成する
                        // コンビニ支払い期限は3日なので、reservationModelは4日有効にする
                        reservationModel.token = Util_1.default.createToken();
                        this.logger.info('saving reservationModel...new token:', reservationModel.token);
                        reservationModel.save((err) => {
                            // GMOへ遷移画面
                            let shopId = conf.get('gmo_payment_shop_id');
                            // TODO 決済管理番号をなにかしら発行する？あるいは予約番号？
                            let orderID = reservationModel.token; // 27桁まで
                            let amount = reservationModel.getTotalPrice();
                            let shopPassword = conf.get('gmo_payment_shop_password');
                            let dateTime = moment().format('YYYYMMDDHHmmss');
                            // 「ショップ ID + オーダーID + 利用金額＋税送料＋ショップパスワード + 日時情報」を MD5 でハッシュした文字列。
                            let md5hash = crypto.createHash('md5');
                            md5hash.update(`${shopId}${orderID}${amount}${shopPassword}${dateTime}`, 'utf8');
                            let shopPassString = md5hash.digest('hex');
                            this.logger.info('redirecting to GMO payment...orderID:', orderID);
                            this.res.render('gmo/reserve/start', {
                                layout: false,
                                reservationModel: reservationModel,
                                shopId: shopId,
                                orderID: orderID,
                                amount: amount,
                                shopPassword: shopPassword,
                                dateTime: dateTime,
                                shopPassString: shopPassString
                            });
                        }, 345600);
                    });
                }
            });
        });
    }
    /**
     * GMOからの結果受信
     * TODO 決済結果チェック文字列を確認する
     */
    result() {
        let gmoResultModel = GMOResultModel_1.default.parse(this.req.body);
        let token = gmoResultModel.OrderID;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }
            // 予約プロセス固有のログファイルをセット
            this.setProcessLogger(reservationModel.paymentNo, () => {
                this.logger.info('reservationModel is ', reservationModel.toLog());
                this.logger.info('gmoResultModel is ', gmoResultModel);
                if (this.req.method === 'POST') {
                    // TODO エラー結果の場合
                    if (gmoResultModel.ErrCode) {
                        this.next(new Error(`エラー結果を受信しました。 ErrCode:${gmoResultModel.ErrCode} ErrInfo:${gmoResultModel.ErrInfo}`));
                    }
                    else {
                        // 決済方法によって振り分け
                        let nextController;
                        switch (gmoResultModel.PayType) {
                            case GMOUtil_1.default.PAY_TYPE_CREDIT:
                                this.logger.info('starting GMOReserveCreditController.result...');
                                let creditController = new GMOReserveCreditController_1.default(this.req, this.res, this.next);
                                creditController.logger = this.logger;
                                creditController.result(reservationModel, gmoResultModel);
                                break;
                            case GMOUtil_1.default.PAY_TYPE_CVS:
                                this.logger.info('starting GMOReserveCsvController.result...');
                                let cvsController = new GMOReserveCvsController_1.default(this.req, this.res, this.next);
                                cvsController.logger = this.logger;
                                cvsController.result(reservationModel, gmoResultModel);
                                break;
                            default:
                                this.next(new Error('対応していない決済方法です'));
                                break;
                        }
                    }
                }
            });
        });
    }
    /**
     * GMO結果通知受信
     * TODO 何かしら決済情報チェック処理を入れる(金額とか)
     */
    notify() {
        // お客様は、受信したHTTPリクエストに対するHTTPレスポンスが必要となります。
        // 返却値については、以下のいずれか
        // 0：受信OK ／ 1：受信失敗
        // 【詳細：返却パラメータ(加盟店様⇒本サービス)】
        // タイムアウトについて
        // 結果通知プログラム機能によって、指定URLへデータ送信を行った場合に15秒以内に返信が無いとタイムアウトとして処
        // 理を行います。
        // 加盟店様側からの正常応答が確認出来なかった場合は約60分毎に5回再送いたします。
        // 以下のいずれかの状態でエラー通知を送信します。
        // 再送で正常終了している場合
        // ■ 通知完了(要求日時と約60分以上の差がある)
        // 再送待ちの場合
        // ■ エラー()
        // 再送も全て通知失敗した場合
        // ■リトライ回数超過
        // Error reportとは
        // 一定時間間隔内で、異常応答または無応答、通知失敗時のいずれかとなった場合にエラーを加盟店様に通知し結果通知プ
        // ログラムの受信状態を確認して頂くためのメールとなります。
        let gmoNotificationModel = GMONotificationModel_1.default.parse(this.req.body);
        let token = gmoNotificationModel.OrderID;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                // TODO ログ
                return this.res.send(GMONotificationResponseModel_1.default.RecvRes_NG);
            }
            // 予約プロセス固有のログファイルをセット
            this.setProcessLogger(reservationModel.paymentNo, () => {
                this.logger.info('reservationModel is ', reservationModel.toLog());
                this.logger.info('gmoNotificationModel is ', gmoNotificationModel);
                switch (gmoNotificationModel.PayType) {
                    case GMOUtil_1.default.PAY_TYPE_CREDIT:
                        this.logger.info('starting GMOReserveCreditController.notify...');
                        let creditController = new GMOReserveCreditController_1.default(this.req, this.res, this.next);
                        creditController.notify(reservationModel, gmoNotificationModel);
                        creditController.logger = this.logger;
                        break;
                    case GMOUtil_1.default.PAY_TYPE_CVS:
                        this.logger.info('starting GMOReserveCsvController.notify...');
                        let cvsController = new GMOReserveCvsController_1.default(this.req, this.res, this.next);
                        cvsController.notify(reservationModel, gmoNotificationModel);
                        cvsController.logger = this.logger;
                        break;
                    default:
                        // 他の決済は本案件では非対応
                        this.res.send(GMONotificationResponseModel_1.default.RecvRes_OK);
                        break;
                }
            });
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = GMOReserveController;
