import ReserveBaseController from '../../ReserveBaseController';
import MemberUser from '../../../models/User/MemberUser';
import Constants from '../../../../common/Util/Constants';
import Util from '../../../../common/Util/Util';
import GMOUtil from '../../../../common/Util/GMO/GMOUtil';
import memberReserveLoginForm from '../../../forms/Member/Reserve/memberReserveLoginForm';
import reserveTicketForm from '../../../forms/Reserve/reserveTicketForm';
import reserveProfileForm from '../../../forms/Reserve/reserveProfileForm';

import Models from '../../../../common/models/Models';
import ReservationUtil from '../../../../common/models/Reservation/ReservationUtil';

import ReservationModel from '../../../models/Reserve/ReservationModel';
import moment = require('moment');

export default class MemberReserveController extends ReserveBaseController {
    /** 予約開始日時 */
    private static RESERVE_START_DATETIME = '2016-10-22T00:00:00+09:00';
    /** 予約終了日時 */
    private static RESERVE_END_DATETIME = '2016-10-24T23:59:59+09:00';

    /**
     * 規約
     */
    public terms(): void {
        // 期限指定
        if (process.env.NODE_ENV === 'prod') {
            let now = moment();
            if (now < moment(Constants.RESERVE_START_DATETIME) || moment(Constants.RESERVE_END_DATETIME) < now) {
                return this.next(new Error('expired.'));
            }
        }

        // ログイン中であればプロセス開始
        // if (this.memberUser.isAuthenticated()) {
        //     return this.res.redirect(this.router.build('member.reserve.start', {}));
        // }

        if (this.req.method === 'POST') {
            memberReserveLoginForm(this.req, this.res, (err) => {
                if (this.req.form.isValid) {
                    // ユーザー認証
                    this.logger.debug('finding member... user_id:', this.req.form['userId']);
                    Models.Member.findOne(
                        {
                            user_id: this.req.form['userId'],
                            password: this.req.form['password'],
                        },
                        (err, member) => {
                            if (err) return this.next(new Error(this.req.__('Message.UnexpectedError')));

                            if (!member) {
                                this.req.form.errors.push('ログイン番号またはパスワードに誤りがあります');
                                this.res.render('member/reserve/terms', {
                                    layout: 'layouts/member/layout'
                                });
                            } else {
                                // 予約の有無を確認
                                Models.Reservation.count(
                                    {
                                        member: member.get('_id'),
                                        purchaser_group: ReservationUtil.PURCHASER_GROUP_MEMBER,
                                        status: ReservationUtil.STATUS_KEPT_BY_MEMBER
                                    },
                                    (err, count) => {
                                        if (err) return this.next(new Error(this.req.__('Message.UnexpectedError')));
                                        if (count === 0) return this.next(new Error(this.req.__('Message.NotFound')));

                                        // ログイン
                                        this.logger.debug('logining...member:', member);
                                        this.req.session[MemberUser.AUTH_SESSION_NAME] = member.toObject();

                                        this.res.redirect(this.router.build('member.reserve.start', {}));
                                    }
                                );
                            }
                        }
                    );
                } else {
                    this.res.render('member/reserve/terms', {
                        layout: 'layouts/member/layout'
                    });
                }
            });
        } else {
            this.res.locals.userId = '';
            this.res.locals.password = '';

            this.res.render('member/reserve/terms', {
                layout: 'layouts/member/layout'
            });
        }
    }

    public start(): void {
        // 予約状況を確認
        this.logger.debug('checking reservation status... member:', this.memberUser.get('_id'));
        Models.Reservation.find(
            {
                member: this.memberUser.get('_id'),
                purchaser_group: ReservationUtil.PURCHASER_GROUP_MEMBER,
                status: ReservationUtil.STATUS_KEPT_BY_MEMBER
            },
            'performance seat_code status',
            (err, reservations) => {
                if (err) return this.next(new Error(this.req.__('Message.UnexpectedError')));
                if (reservations.length === 0) return this.next(new Error(this.req.__('Message.NotFound')));

                // 予約トークンを発行
                let token = Util.createToken();
                let reservationModel = new ReservationModel();
                reservationModel.token = token;
                reservationModel.purchaserGroup = ReservationUtil.PURCHASER_GROUP_MEMBER;

                // パフォーマンスFIX
                this.processFixPerformance(reservationModel, reservations[0].get('performance').toString(), (err, reservationModel) => {
                    if (err) return this.next(new Error(this.req.__('Message.UnexpectedError')));

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
                            seat_grade_name: seatInfo.grade.name,
                            seat_grade_name_en: seatInfo.grade.name_en,
                            seat_grade_additional_charge: seatInfo.grade.additional_charge
                        });
                    }


                    // パフォーマンスと座席指定した状態で券種選択へ
                    this.logger.debug('saving reservationModel... ', reservationModel);
                    reservationModel.save((err) => {
                        this.res.redirect(this.router.build('member.reserve.tickets', {token: token}));
                    });

                });
            }
        );

    }

    /**
     * 券種選択
     */
    public tickets(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err) return this.next(new Error(this.req.__('Message.Expired')));

            if (this.req.method === 'POST') {
                reserveTicketForm(this.req, this.res, (err) => {
                    if (this.req.form.isValid) {
                        // 座席選択情報を保存して座席選択へ
                        let choices = JSON.parse(this.req.form['choices']);

                        if (Array.isArray(choices)) {
                            choices.forEach((choice, index) => {
                                let reservation = reservationModel.getReservation(choice.seat_code);

                                let ticketType = reservationModel.ticketTypes.find((ticketType) => {
                                    return (ticketType.code === choice.ticket_type_code);
                                });
                                if (!ticketType) {
                                    return this.next(new Error(this.req.__('Message.UnexpectedError')));
                                }

                                reservation.ticket_type_code = ticketType.code;
                                reservation.ticket_type_name = ticketType.name;
                                reservation.ticket_type_name_en = ticketType.name_en;
                                reservation.ticket_type_charge = ticketType.charge;;

                                reservationModel.setReservation(reservation._id, reservation);
                            });

                            this.logger.debug('saving reservationModel... ', reservationModel);
                            reservationModel.save((err) => {
                                this.res.redirect(this.router.build('member.reserve.profile', {token: token}));
                            });

                        } else {
                            this.next(new Error(this.req.__('Message.UnexpectedError')));
                        }

                    } else {
                        this.res.redirect(this.router.build('member.reserve.tickets', {token: token}));

                    }

                });
            } else {
                this.res.render('member/reserve/tickets', {
                    layout: 'layouts/member/layout',
                    reservationModel: reservationModel,
                });

            }

        });
    }

    /**
     * 購入者情報
     */
    public profile(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err) return this.next(new Error(this.req.__('Message.Expired')));

            if (this.req.method === 'POST') {
                let form = reserveProfileForm(this.req);
                form(this.req, this.res, (err) => {
                    if (this.req.form.isValid) {
                        // 購入者情報を保存して座席選択へ
                        reservationModel.profile = {
                            last_name: this.req.form['lastName'],
                            first_name: this.req.form['firstName'],
                            email: this.req.form['email'],
                            tel: this.req.form['tel']
                        };

                        reservationModel.paymentMethod = GMOUtil.PAY_TYPE_CREDIT;

                        this.logger.debug('saving reservationModel... ', reservationModel);
                        reservationModel.save((err) => {
                            this.res.redirect(this.router.build('member.reserve.confirm', {token: token}));
                        });

                    } else {
                        this.res.render('member/reserve/profile', {
                            layout: 'layouts/member/layout',
                            reservationModel: reservationModel,
                        });

                    }

                });

            } else {
                this.res.locals.lastName = '';
                this.res.locals.firstName = '';
                this.res.locals.tel = '';
                this.res.locals.email = '';
                this.res.locals.emailConfirm = '';
                this.res.locals.emailConfirmDomain = '';
                this.res.locals.paymentMethod = GMOUtil.PAY_TYPE_CREDIT;

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

                this.res.render('member/reserve/profile', {
                    layout: 'layouts/member/layout',
                    reservationModel: reservationModel
                });

            }

        });
    }

    /**
     * 予約内容確認
     */
    public confirm(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err) return this.next(new Error(this.req.__('Message.Expired')));

            if (this.req.method === 'POST') {
                // 購入番号発行
                this.createPaymentNo((err, paymentNo) => {
                    if (err) {
                        let message = this.req.__('Message.UnexpectedError');
                        this.res.redirect(`${this.router.build('customer.reserve.confirm', {token: token})}?message=${encodeURIComponent(message)}`);

                    } else {
                        reservationModel.paymentNo = paymentNo;

                        // 予約プロセス固有のログファイルをセット
                        this.setProcessLogger(reservationModel.paymentNo, () => {
                            this.logger.info('paymentNo published. paymentNo:', reservationModel.paymentNo);

                            // いったん全情報をDBに保存
                            let promises = [];
                            let reservationDocuments4update = reservationModel.toReservationDocuments();
                            for (let reservationDocument4update of reservationDocuments4update) {
                                reservationDocument4update['member'] = this.memberUser.get('_id');
                                reservationDocument4update['member_user_id'] = this.memberUser.get('user_id');

                                promises.push(new Promise((resolve, reject) => {
                                    this.logger.info('updating reservation all infos..._id:', reservationDocument4update['_id']);
                                    Models.Reservation.update(
                                        {
                                            _id: reservationDocument4update['_id'],
                                            status: ReservationUtil.STATUS_KEPT_BY_MEMBER
                                        },
                                        reservationDocument4update,
                                        (err, raw) => {
                                            this.logger.info('reservation updated.', err, raw);
                                            if (err) {
                                                reject(new Error(this.req.__('Message.UnexpectedError')));
                                            } else {
                                                resolve();
                                            }

                                        }
                                    );

                                }));
                            };

                            Promise.all(promises).then(() => {
                                reservationModel.save((err) => {
                                    this.logger.info('starting GMO payment...');
                                    this.res.redirect(307, this.router.build('gmo.reserve.start', {token: token}));
                                });
                            }, (err) => {
                                let message = err.message;
                                this.res.redirect(`${this.router.build('customer.reserve.confirm', {token: token})}?message=${encodeURIComponent(message)}`);
                            });
                        });
                    }
                });

            } else {
                this.res.render('member/reserve/confirm', {
                    layout: 'layouts/member/layout',
                    reservationModel: reservationModel
                });
            }
        });
    }

    /**
     * 予約完了
     */
    public complete(): void {
        let paymentNo = this.req.params.paymentNo;
        Models.Reservation.find(
            {
                payment_no: paymentNo,
                status: ReservationUtil.STATUS_RESERVED,
                member: this.memberUser.get('_id')
            },
            (err, reservationDocuments) => {
                if (err) return this.next(new Error(this.req.__('Message.UnexpectedError')));
                if (reservationDocuments.length === 0) return this.next(new Error(this.req.__('Message.NotFound')));

                // TODO force to logout??
                // delete this.req.session[MemberUser.AUTH_SESSION_NAME];

                this.res.render('member/reserve/complete', {
                    layout: 'layouts/member/layout',
                    reservationDocuments: reservationDocuments
                });

            }
        );
    }
}
