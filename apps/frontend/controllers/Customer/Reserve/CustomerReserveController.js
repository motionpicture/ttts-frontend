"use strict";
const ReserveBaseController_1 = require('../../ReserveBaseController');
const Util_1 = require('../../../../common/Util/Util');
const GMOUtil_1 = require('../../../../common/Util/GMO/GMOUtil');
const reservePerformanceForm_1 = require('../../../forms/Reserve/reservePerformanceForm');
const reserveSeatForm_1 = require('../../../forms/Reserve/reserveSeatForm');
const reserveTicketForm_1 = require('../../../forms/Reserve/reserveTicketForm');
const reserveProfileForm_1 = require('../../../forms/Reserve/reserveProfileForm');
const Models_1 = require('../../../../common/models/Models');
const ReservationUtil_1 = require('../../../../common/models/Reservation/ReservationUtil');
const FilmUtil_1 = require('../../../../common/models/Film/FilmUtil');
const ReservationModel_1 = require('../../../models/Reserve/ReservationModel');
const lockFile = require('lockfile');
class CustomerReserveController extends ReserveBaseController_1.default {
    /**
     * スケジュール選択
     */
    performances() {
        if (this.req.method === 'POST') {
            reservePerformanceForm_1.default(this.req, this.res, (err) => {
                if (this.req.form.isValid) {
                    this.res.redirect(307, this.router.build('customer.reserve.start'));
                }
                else {
                    this.res.render('customer/reserve/performances', {});
                }
            });
        }
        else {
            this.res.render('customer/reserve/performances', {
                FilmUtil: FilmUtil_1.default
            });
        }
    }
    /**
     * ポータルからパフォーマンス指定でPOSTされてくる
     */
    start() {
        reservePerformanceForm_1.default(this.req, this.res, (err) => {
            if (this.req.form.isValid) {
                // 予約トークンを発行
                let token = Util_1.default.createToken();
                let reservationModel = new ReservationModel_1.default();
                reservationModel.token = token;
                // パフォーマンスFIX
                this.processFixPerformance(reservationModel, this.req.form['performanceId'], (err, reservationModel) => {
                    if (err) {
                        this.next(err);
                    }
                    else {
                        reservationModel.save((err) => {
                            this.res.redirect(`${this.router.build('customer.login')}?cb=${encodeURIComponent(this.router.build('customer.reserve.login', { token: token }))}`);
                        });
                    }
                });
            }
            else {
                this.next(new Error(this.req.__('Message.UnexpectedError')));
            }
        });
    }
    login() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }
            reservationModel.mvtkMemberInfoResult = this.mvtkUser.memberInfoResult;
            reservationModel.save((err) => {
                this.res.redirect(this.router.build('customer.reserve.seats', { token: token }));
            });
        });
    }
    /**
     * 座席選択
     */
    seats() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }
            // 1アカウント1パフォーマンスごとに枚数制限
            let lockPath = `${__dirname}/../../../../../lock/CustomerFixSeats${this.mvtkUser.memberInfoResult.kiinCd}${reservationModel.performance._id}.lock`;
            lockFile.lock(lockPath, { wait: 5000 }, (err) => {
                Models_1.default.Reservation.count({
                    mvtk_kiin_cd: this.mvtkUser.memberInfoResult.kiinCd,
                    performance: reservationModel.performance._id,
                    status: {
                        $ne: ReservationUtil_1.default.STATUS_AVAILABLE
                    },
                    _id: {
                        $nin: reservationModel.reservationIds // 現在のフロー中の予約は除く
                    }
                }, (err, reservationsCount) => {
                    let limit = CustomerReserveController.RESERVATION_LIMIT_PER_PERFORMANCE - reservationsCount;
                    // すでに枚数制限に達している場合
                    if (limit <= 0) {
                        lockFile.unlock(lockPath, (err) => {
                            this.next(new Error(this.req.__('Message.seatsLimit{{limit}}', { limit: limit.toString() })));
                        });
                    }
                    else {
                        if (this.req.method === 'POST') {
                            reserveSeatForm_1.default(this.req, this.res, (err) => {
                                if (this.req.form.isValid) {
                                    let reservationIds = JSON.parse(this.req.form['reservationIds']);
                                    // 追加指定席を合わせて制限枚数を超過した場合
                                    if (reservationIds.length > limit) {
                                        lockFile.unlock(lockPath, (err) => {
                                            let message = this.req.__('Message.seatsLimit{{limit}}', { limit: limit.toString() });
                                            this.res.redirect(`${this.router.build('customer.reserve.seats', { token: token })}?message=${encodeURIComponent(message)}`);
                                        });
                                    }
                                    else {
                                        // 座席FIX
                                        this.processFixSeats(reservationModel, reservationIds, (err, reservationModel) => {
                                            lockFile.unlock(lockPath, (err) => {
                                                if (err) {
                                                    this.next(err);
                                                }
                                                else {
                                                    this.logger.debug('saving reservationModel... ', reservationModel);
                                                    reservationModel.save((err) => {
                                                        // 仮予約に失敗した座席コードがあった場合
                                                        if (reservationIds.length > reservationModel.reservationIds.length) {
                                                            let message = '座席を確保できませんでした。再度指定してください。';
                                                            this.res.redirect(`${this.router.build('customer.reserve.seats', { token: token })}?message=${encodeURIComponent(message)}`);
                                                        }
                                                        else {
                                                            // 券種選択へ
                                                            this.res.redirect(this.router.build('customer.reserve.tickets', { token: token }));
                                                        }
                                                    });
                                                }
                                            });
                                        });
                                    }
                                }
                                else {
                                    lockFile.unlock(lockPath, (err) => {
                                        this.res.redirect(this.router.build('customer.reserve.seats', { token: token }));
                                    });
                                }
                            });
                        }
                        else {
                            lockFile.unlock(lockPath, (err) => {
                                this.res.render('customer/reserve/seats', {
                                    reservationModel: reservationModel,
                                    limit: limit
                                });
                            });
                        }
                    }
                });
            });
        });
    }
    /**
     * 券種選択
     */
    tickets() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }
            this.logger.debug('reservationModel is ', reservationModel.toLog());
            if (this.req.method === 'POST') {
                reserveTicketForm_1.default(this.req, this.res, (err) => {
                    if (this.req.form.isValid) {
                        // 座席選択情報を保存して座席選択へ
                        let choices = JSON.parse(this.req.form['choices']);
                        if (Array.isArray(choices)) {
                            choices.forEach((choice) => {
                                let reservation = reservationModel.getReservation(choice.reservation_id);
                                let ticketType = reservationModel.ticketTypes.find((ticketType) => {
                                    return (ticketType.code === choice.ticket_type_code);
                                });
                                if (!ticketType) {
                                    return this.next(new Error(this.req.__('Message.UnexpectedError')));
                                }
                                reservation.ticket_type_code = ticketType.code;
                                reservation.ticket_type_name = ticketType.name;
                                reservation.ticket_type_name_en = ticketType.name_en;
                                reservation.ticket_type_charge = ticketType.charge;
                                ;
                                reservationModel.setReservation(reservation._id, reservation);
                            });
                            this.logger.debug('saving reservationModel... ', reservationModel);
                            reservationModel.save((err) => {
                                this.res.redirect(this.router.build('customer.reserve.profile', { token: token }));
                            });
                        }
                        else {
                            this.next(new Error(this.req.__('Message.UnexpectedError')));
                        }
                    }
                    else {
                        this.res.redirect(this.router.build('customer.reserve.tickets', { token: token }));
                    }
                });
            }
            else {
                this.res.render('customer/reserve/tickets', {
                    reservationModel: reservationModel,
                });
            }
        });
    }
    /**
     * 購入者情報
     */
    profile() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }
            this.logger.debug('reservationModel is ', reservationModel.toLog());
            this.res.locals.GMOUtil = GMOUtil_1.default;
            if (this.req.method === 'POST') {
                let form = reserveProfileForm_1.default(this.req);
                form(this.req, this.res, (err) => {
                    if (this.req.form.isValid) {
                        // 購入者情報を保存して座席選択へ
                        reservationModel.profile = {
                            last_name: this.req.form['lastName'],
                            first_name: this.req.form['firstName'],
                            email: this.req.form['email'],
                            tel: this.req.form['tel']
                        };
                        reservationModel.paymentMethod = this.req.form['paymentMethod'];
                        this.logger.debug('saving reservationModel... ', reservationModel);
                        reservationModel.save((err) => {
                            this.res.redirect(this.router.build('customer.reserve.confirm', { token: token }));
                        });
                    }
                    else {
                        this.res.render('customer/reserve/profile', {
                            reservationModel: reservationModel
                        });
                    }
                });
            }
            else {
                let email = this.mvtkUser.memberInfoResult.kiinMladdr;
                this.res.locals.lastName = this.mvtkUser.memberInfoResult.kiinsiNm;
                this.res.locals.firstName = this.mvtkUser.memberInfoResult.kiimmiNm;
                this.res.locals.tel = `${this.mvtkUser.memberInfoResult.kiinshgikykNo}${this.mvtkUser.memberInfoResult.kiinshnikykNo}${this.mvtkUser.memberInfoResult.kiinknyshNo}`;
                this.res.locals.email = email;
                this.res.locals.emailConfirm = email.substr(0, email.indexOf('@'));
                this.res.locals.emailConfirmDomain = email.substr(email.indexOf('@') + 1);
                this.res.locals.paymentMethod = GMOUtil_1.default.PAY_TYPE_CREDIT;
                // セッションに情報があれば、フォーム初期値設定
                if (reservationModel.profile) {
                    let email = reservationModel.profile.email;
                    this.res.locals.lastName = reservationModel.profile.last_name;
                    this.res.locals.firstName = reservationModel.profile.first_name;
                    this.res.locals.tel = reservationModel.profile.tel;
                    this.res.locals.email = email;
                    this.res.locals.emailConfirm = email.substr(0, email.indexOf('@'));
                    this.res.locals.emailConfirmDomain = email.substr(email.indexOf('@') + 1);
                }
                if (reservationModel.paymentMethod) {
                    this.res.locals.paymentMethod = reservationModel.paymentMethod;
                }
                this.res.render('customer/reserve/profile', {
                    reservationModel: reservationModel
                });
            }
        });
    }
    /**
     * 予約内容確認
     */
    confirm() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }
            this.logger.debug('reservationModel is ', reservationModel.toLog());
            if (this.req.method === 'POST') {
                // ここで予約番号発行
                reservationModel.paymentNo = Util_1.default.createPaymentNo();
                // 予約プロセス固有のログファイルをセット
                this.setProcessLogger(reservationModel.paymentNo, () => {
                    this.logger.info('paymentNo published. paymentNo:', reservationModel.paymentNo);
                    // いったん全情報をDBに保存
                    let promises = [];
                    let reservationDocuments4update = reservationModel.toReservationDocuments();
                    for (let reservationDocument4update of reservationDocuments4update) {
                        promises.push(new Promise((resolve, reject) => {
                            // reservationDocument4update['status'] = ReservationUtil.STATUS_GMO_PROCESSING;
                            this.logger.info('updating reservation all infos..._id:', reservationDocument4update['_id']);
                            Models_1.default.Reservation.update({
                                _id: reservationDocument4update['_id'],
                                status: ReservationUtil_1.default.STATUS_TEMPORARY
                            }, reservationDocument4update, (err, raw) => {
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
                        reservationModel.save((err) => {
                            this.logger.info('starting GMO payment...');
                            this.res.redirect(this.router.build('gmo.reserve.start', { token: token }));
                        });
                    }, (err) => {
                        this.res.render('customer/reserve/confirm', {
                            reservationModel: reservationModel,
                            ReservationUtil: ReservationUtil_1.default
                        });
                    });
                });
            }
            else {
                this.res.render('customer/reserve/confirm', {
                    reservationModel: reservationModel,
                    ReservationUtil: ReservationUtil_1.default
                });
            }
        });
    }
    /**
     * 仮予約完了
     */
    waitingSettlement() {
        let paymentNo = this.req.params.paymentNo;
        Models_1.default.Reservation.find({
            payment_no: paymentNo,
            status: ReservationUtil_1.default.STATUS_WAITING_SETTLEMENT,
            mvtk_kiin_cd: this.mvtkUser.memberInfoResult.kiinCd
        }, (err, reservationDocuments) => {
            if (err || reservationDocuments.length < 1) {
                return this.next(new Error(this.req.__('Message.UnexpectedError')));
            }
            this.res.render('customer/reserve/waitingSettlement', {
                reservationDocuments: reservationDocuments
            });
        });
    }
    /**
     * 予約完了
     */
    complete() {
        let paymentNo = this.req.params.paymentNo;
        Models_1.default.Reservation.find({
            payment_no: paymentNo,
            status: ReservationUtil_1.default.STATUS_RESERVED,
            mvtk_kiin_cd: this.mvtkUser.memberInfoResult.kiinCd
        }, (err, reservationDocuments) => {
            if (err || reservationDocuments.length < 1) {
                return this.next(new Error(this.req.__('Message.UnexpectedError')));
            }
            this.res.render('customer/reserve/complete', {
                reservationDocuments: reservationDocuments
            });
        });
    }
}
CustomerReserveController.RESERVATION_LIMIT_PER_PERFORMANCE = 4; // パフォーマンスあたりの最大座席確保枚数
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = CustomerReserveController;
