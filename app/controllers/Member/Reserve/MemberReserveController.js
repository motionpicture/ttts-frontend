"use strict";
const ReserveBaseController_1 = require("../../ReserveBaseController");
const GMOUtil_1 = require("../../../../common/Util/GMO/GMOUtil");
const ttts_domain_1 = require("@motionpicture/ttts-domain");
const ttts_domain_2 = require("@motionpicture/ttts-domain");
const ttts_domain_3 = require("@motionpicture/ttts-domain");
const ReservationModel_1 = require("../../../models/Reserve/ReservationModel");
const moment = require("moment");
class MemberReserveController extends ReserveBaseController_1.default {
    constructor() {
        super(...arguments);
        this.purchaserGroup = ttts_domain_2.ReservationUtil.PURCHASER_GROUP_MEMBER;
        this.layout = 'layouts/member/layout';
    }
    start() {
        // 予約状況を確認
        ttts_domain_1.Models.Reservation.find({
            member_user_id: this.req.memberUser.get('user_id'),
            purchaser_group: this.purchaserGroup,
            status: ttts_domain_2.ReservationUtil.STATUS_KEPT_BY_MEMBER
        }, 'performance seat_code status', (err, reservations) => {
            if (err)
                return this.next(new Error(this.req.__('Message.UnexpectedError')));
            if (reservations.length === 0)
                return this.next(new Error(this.req.__('Message.NoAvailableSeats')));
            this.processStart((err, reservationModel) => {
                if (err)
                    this.next(new Error(this.req.__('Message.UnexpectedError')));
                if (reservationModel.performance) {
                }
                else {
                    // パフォーマンスFIX
                    this.processFixPerformance(reservationModel, reservations[0].get('performance').toString(), (err, reservationModel) => {
                        if (err)
                            return this.next(new Error(this.req.__('Message.UnexpectedError')));
                        // 座席FIX
                        for (let reservation of reservations) {
                            let seatInfo = reservationModel.performance.screen.sections[0].seats.find((seat) => {
                                return (seat.code === reservation.get('seat_code'));
                            });
                            reservationModel.seatCodes.push(reservation.get('seat_code'));
                            reservationModel.setReservation(reservation.get('seat_code'), {
                                _id: reservation.get('_id'),
                                status: reservation.get('status'),
                                seat_code: reservation.get('seat_code'),
                                seat_grade_name_ja: seatInfo.grade.name.ja,
                                seat_grade_name_en: seatInfo.grade.name.en,
                                seat_grade_additional_charge: seatInfo.grade.additional_charge,
                                ticket_type_code: null,
                                ticket_type_name_ja: null,
                                ticket_type_name_en: null,
                                ticket_type_charge: 0,
                                watcher_name: null
                            });
                        }
                        // パフォーマンスと座席指定した状態で券種選択へ
                        reservationModel.save(() => {
                            this.res.redirect(this.router.build('member.reserve.tickets', { token: reservationModel.token }));
                        });
                    });
                }
            });
        });
    }
    terms() {
        this.next(new Error('Message.NotFound'));
    }
    performances() {
        this.next(new Error('Message.NotFound'));
    }
    seats() {
        this.next(new Error('Message.NotFound'));
    }
    /**
     * 券種選択
     */
    tickets() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err)
                return this.next(new Error(this.req.__('Message.Expired')));
            if (this.req.method === 'POST') {
                this.processFixTickets(reservationModel, (err, reservationModel) => {
                    if (err) {
                        this.res.redirect(this.router.build('member.reserve.tickets', { token: token }));
                    }
                    else {
                        reservationModel.save(() => {
                            this.res.redirect(this.router.build('member.reserve.profile', { token: token }));
                        });
                    }
                });
            }
            else {
                this.res.render('member/reserve/tickets', {
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
            if (err)
                return this.next(new Error(this.req.__('Message.Expired')));
            if (this.req.method === 'POST') {
                this.processFixProfile(reservationModel, (err, reservationModel) => {
                    if (err) {
                        this.res.render('member/reserve/profile', {
                            reservationModel: reservationModel
                        });
                    }
                    else {
                        reservationModel.save(() => {
                            this.res.redirect(this.router.build('member.reserve.confirm', { token: token }));
                        });
                    }
                });
            }
            else {
                // セッションに情報があれば、フォーム初期値設定
                let email = reservationModel.purchaserEmail;
                this.res.locals.lastName = reservationModel.purchaserLastName;
                this.res.locals.firstName = reservationModel.purchaserFirstName;
                this.res.locals.tel = reservationModel.purchaserTel;
                this.res.locals.age = reservationModel.purchaserAge;
                this.res.locals.address = reservationModel.purchaserAddress;
                this.res.locals.gender = reservationModel.purchaserGender;
                this.res.locals.email = (email) ? email : '';
                this.res.locals.emailConfirm = (email) ? email.substr(0, email.indexOf('@')) : '';
                this.res.locals.emailConfirmDomain = (email) ? email.substr(email.indexOf('@') + 1) : '';
                this.res.locals.paymentMethod = (reservationModel.paymentMethod) ? reservationModel.paymentMethod : GMOUtil_1.default.PAY_TYPE_CREDIT;
                this.res.render('member/reserve/profile', {
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
            if (err)
                return this.next(new Error(this.req.__('Message.Expired')));
            if (this.req.method === 'POST') {
                this.processConfirm(reservationModel, (err, reservationModel) => {
                    if (err) {
                        reservationModel.remove(() => {
                            this.next(err);
                        });
                    }
                    else {
                        reservationModel.save(() => {
                            this.logger.info('starting GMO payment...');
                            this.res.redirect(308, this.router.build('gmo.reserve.start', { token: token }) + `?locale=${this.req.getLocale()}`);
                        });
                    }
                });
            }
            else {
                this.res.render('member/reserve/confirm', {
                    reservationModel: reservationModel
                });
            }
        });
    }
    /**
     * 予約完了
     */
    complete() {
        let paymentNo = this.req.params.paymentNo;
        ttts_domain_1.Models.Reservation.find({
            payment_no: paymentNo,
            status: ttts_domain_2.ReservationUtil.STATUS_RESERVED,
            purchased_at: {
                $gt: moment().add(-30, 'minutes').toISOString()
            }
        }, (err, reservations) => {
            if (err)
                return this.next(new Error(this.req.__('Message.UnexpectedError')));
            if (reservations.length === 0)
                return this.next(new Error(this.req.__('Message.NotFound')));
            reservations.sort((a, b) => {
                return ttts_domain_3.ScreenUtil.sortBySeatCode(a.get('seat_code'), b.get('seat_code'));
            });
            this.res.render('member/reserve/complete', {
                reservationDocuments: reservations
            });
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = MemberReserveController;
