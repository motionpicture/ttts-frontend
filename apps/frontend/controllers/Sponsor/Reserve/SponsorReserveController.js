"use strict";
const ReserveBaseController_1 = require('../../ReserveBaseController');
const SponsorUser_1 = require('../../../models/User/SponsorUser');
const Util_1 = require('../../../../common/Util/Util');
const reservePerformanceForm_1 = require('../../../forms/Reserve/reservePerformanceForm');
const reserveSeatForm_1 = require('../../../forms/Reserve/reserveSeatForm');
const reserveTicketForm_1 = require('../../../forms/Reserve/reserveTicketForm');
const reserveProfileForm_1 = require('../../../forms/Reserve/reserveProfileForm');
const Models_1 = require('../../../../common/models/Models');
const ReservationUtil_1 = require('../../../../common/models/Reservation/ReservationUtil');
const FilmUtil_1 = require('../../../../common/models/Film/FilmUtil');
const ReservationModel_1 = require('../../../models/Reserve/ReservationModel');
class SponsorReserveController extends ReserveBaseController_1.default {
    start() {
        // 予約トークンを発行
        let token = Util_1.default.createToken();
        let reservationModel = new ReservationModel_1.default();
        reservationModel.token = token;
        reservationModel.sponsor = {
            _id: this.sponsorUser.get('_id'),
            user_id: this.sponsorUser.get('user_id'),
            name: this.sponsorUser.get('name'),
            email: this.sponsorUser.get('email'),
        };
        // スケジュール選択へ
        this.logger.debug('saving reservationModel... ', reservationModel);
        reservationModel.save((err) => {
            this.res.redirect(this.router.build('sponsor.reserve.performances', { token: token }));
        });
    }
    /**
     * スケジュール選択
     */
    performances() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }
            // 外部関係者による予約数を取得
            Models_1.default.Reservation.count({
                sponsor: this.sponsorUser.get('_id'),
                status: {
                    $ne: ReservationUtil_1.default.STATUS_AVAILABLE
                }
            }, (err, reservationsCount) => {
                if (parseInt(this.sponsorUser.get('max_reservation_count')) <= reservationsCount) {
                    return this.next(new Error(this.req.__('Message.seatsLimit{{limit}}', { limit: this.sponsorUser.get('max_reservation_count') })));
                }
                if (this.req.method === 'POST') {
                    reservePerformanceForm_1.default(this.req, this.res, (err) => {
                        if (this.req.form.isValid) {
                            // パフォーマンスFIX
                            this.processFixPerformance(reservationModel, this.req.form['performanceId'], (err, reservationModel) => {
                                if (err) {
                                    this.next(err);
                                }
                                else {
                                    this.logger.debug('saving reservationModel... ', reservationModel);
                                    reservationModel.save((err) => {
                                        this.res.redirect(this.router.build('sponsor.reserve.seats', { token: token }));
                                    });
                                }
                            });
                        }
                        else {
                            this.next(new Error('不適切なアクセスです'));
                        }
                    });
                }
                else {
                    // 仮予約あればキャンセルする
                    this.processCancelSeats(reservationModel, (err, reservationModel) => {
                        this.logger.debug('saving reservationModel... ', reservationModel);
                        reservationModel.save((err) => {
                            this.res.render('sponsor/reserve/performances', {
                                layout: 'layouts/sponsor/layout',
                                FilmUtil: FilmUtil_1.default,
                                reservationsCount: reservationsCount
                            });
                        });
                    });
                }
            });
        });
    }
    /**
     * 座席選択
     */
    seats() {
        // TODO 最勝ちで、残り枚数を厳密に守る(ユーザーにロックかける)
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }
            this.logger.debug('reservationModel is ', reservationModel.toLog());
            // 外部関係者による予約数を取得
            Models_1.default.Reservation.count({
                sponsor: this.sponsorUser.get('_id'),
                status: {
                    $ne: ReservationUtil_1.default.STATUS_AVAILABLE
                }
            }, (err, reservationsCount) => {
                if (this.req.method === 'POST') {
                    reserveSeatForm_1.default(this.req, this.res, (err) => {
                        if (this.req.form.isValid) {
                            let reservationIds = JSON.parse(this.req.form['reservationIds']);
                            // 座席指定可能数チェック
                            if (reservationIds.length > parseInt(this.sponsorUser.get('max_reservation_count')) - reservationsCount) {
                                let message = '座席指定可能枚数を超えました。';
                                return this.res.redirect(this.router.build('sponsor.reserve.seats', { token: token }) + `?message=${encodeURIComponent(message)}`);
                            }
                            // 座席FIX
                            this.processFixSeats(reservationModel, reservationIds, (err, reservationModel) => {
                                if (err) {
                                    this.next(err);
                                }
                                else {
                                    this.logger.debug('saving reservationModel... ', reservationModel);
                                    reservationModel.save((err) => {
                                        // 仮予約に失敗した座席コードがあった場合
                                        if (reservationIds.length > reservationModel.reservationIds.length) {
                                            // TODO メッセージ？
                                            let message = '座席を確保できませんでした。再度指定してください。';
                                            this.res.redirect(this.router.build('sponsor.reserve.seats', { token: token }) + `?message=${encodeURIComponent(message)}`);
                                        }
                                        else {
                                            this.res.redirect(this.router.build('sponsor.reserve.tickets', { token: token }));
                                        }
                                    });
                                }
                            });
                        }
                        else {
                            this.res.redirect(this.router.build('sponsor.reserve.seats', { token: token }));
                        }
                    });
                }
                else {
                    this.res.render('sponsor/reserve/seats', {
                        layout: 'layouts/sponsor/layout',
                        reservationModel: reservationModel,
                        reservationsCount: reservationsCount
                    });
                }
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
                                    return this.next(new Error('不適切なアクセスです'));
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
                                this.res.redirect(this.router.build('sponsor.reserve.profile', { token: token }));
                            });
                        }
                        else {
                            this.next(new Error('不適切なアクセスです'));
                        }
                    }
                    else {
                        this.res.redirect(this.router.build('sponsor.reserve.tickets', { token: token }));
                    }
                });
            }
            else {
                this.res.render('sponsor/reserve/tickets', {
                    layout: 'layouts/sponsor/layout',
                    reservationModel: reservationModel,
                });
            }
        });
    }
    /**
     * 購入者情報
     * TODO 同セッション内では、情報を保持する
     */
    profile() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }
            this.logger.debug('reservationModel is ', reservationModel.toLog());
            if (this.req.method === 'POST') {
                let form = reserveProfileForm_1.default(this.req);
                form(this.req, this.res, (err) => {
                    if (this.req.form.isValid) {
                        // 購入者情報を保存して座席選択へ
                        reservationModel.profile = {
                            last_name: this.req.form['lastName'],
                            first_name: this.req.form['firstName'],
                            email: this.req.form['email'],
                            tel: this.req.form['tel'],
                        };
                        this.logger.debug('saving reservationModel... ', reservationModel);
                        reservationModel.save((err) => {
                            // ユーザーセッションにプローフィール格納
                            this.sponsorUser.profile = {
                                last_name: this.req.form['lastName'],
                                first_name: this.req.form['firstName'],
                                email: this.req.form['email'],
                                tel: this.req.form['tel']
                            };
                            this.req.session[SponsorUser_1.default.AUTH_SESSION_NAME] = this.sponsorUser;
                            this.res.redirect(this.router.build('sponsor.reserve.confirm', { token: token }));
                        });
                    }
                    else {
                        this.res.render('sponsor/reserve/profile', {
                            layout: 'layouts/sponsor/layout',
                            reservationModel: reservationModel,
                        });
                    }
                });
            }
            else {
                this.res.locals.lastName = '';
                this.res.locals.firstName = '';
                this.res.locals.tel = '';
                this.res.locals.email = '';
                this.res.locals.emailConfirm = '';
                this.res.locals.emailConfirmDomain = '';
                // ユーザーセッションに情報があれば、フォーム初期値設定
                if (this.sponsorUser.profile) {
                    let email = this.sponsorUser.profile.email;
                    this.res.locals.lastName = this.sponsorUser.profile.last_name;
                    this.res.locals.firstName = this.sponsorUser.profile.first_name;
                    this.res.locals.tel = this.sponsorUser.profile.tel;
                    this.res.locals.email = email;
                    this.res.locals.emailConfirm = email.substr(0, email.indexOf('@'));
                    this.res.locals.emailConfirmDomain = email.substr(email.indexOf('@') + 1);
                }
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
                this.res.render('sponsor/reserve/profile', {
                    layout: 'layouts/sponsor/layout',
                    reservationModel: reservationModel,
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
                    let promises = [];
                    let reservationDocuments4update = reservationModel.toReservationDocuments();
                    for (let reservationDocument4update of reservationDocuments4update) {
                        promises.push(new Promise((resolve, reject) => {
                            // 予約完了
                            reservationDocument4update['status'] = ReservationUtil_1.default.STATUS_RESERVED;
                            this.logger.info('updating reservation all infos..._id:', reservationDocument4update['_id']);
                            Models_1.default.Reservation.findOneAndUpdate({
                                _id: reservationDocument4update['_id'],
                            }, reservationDocument4update, {
                                new: true
                            }, (err, reservationDocument) => {
                                this.logger.info('reservation updated.', err, reservationDocument);
                                if (err) {
                                    // TODO ログ出力
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
                        reservationModel.remove((err) => {
                            this.logger.info('redirecting to complete...');
                            this.res.redirect(this.router.build('sponsor.reserve.complete', { paymentNo: reservationModel.paymentNo }));
                        });
                    }, (err) => {
                        this.res.render('sponsor/reserve/confirm', {
                            layout: 'layouts/sponsor/layout',
                            reservationModel: reservationModel
                        });
                    });
                });
            }
            else {
                this.res.render('sponsor/reserve/confirm', {
                    layout: 'layouts/sponsor/layout',
                    reservationModel: reservationModel
                });
            }
        });
    }
    /**
     * TODO 続けて予約するボタンを追加
     */
    complete() {
        let paymentNo = this.req.params.paymentNo;
        Models_1.default.Reservation.find({
            payment_no: paymentNo,
            status: ReservationUtil_1.default.STATUS_RESERVED,
            sponsor: this.sponsorUser.get('_id')
        }, (err, reservationDocuments) => {
            if (err || reservationDocuments.length < 1) {
                // TODO
                return this.next(new Error('invalid access.'));
            }
            this.res.render('sponsor/reserve/complete', {
                layout: 'layouts/sponsor/layout',
                reservationDocuments: reservationDocuments
            });
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SponsorReserveController;
