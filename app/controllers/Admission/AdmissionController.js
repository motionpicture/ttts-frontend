"use strict";
const ttts_domain_1 = require("@motionpicture/ttts-domain");
const ttts_domain_2 = require("@motionpicture/ttts-domain");
const ttts_domain_3 = require("@motionpicture/ttts-domain");
const BaseController_1 = require("../BaseController");
/**
 * 入場コントローラー
 *
 * 上映当日入場画面から使う機能はここにあります。
 *
 * @class AdmissionController
 */
class AdmissionController extends BaseController_1.default {
    constructor() {
        super(...arguments);
        this.layout = 'layouts/admission/layout';
    }
    /**
     * 入場画面のパフォーマンス検索
     *
     * @memberOf AdmissionController
     */
    performances() {
        if (this.req.method === 'POST') {
            if (this.req.body.performanceId) {
                this.res.redirect(this.router.build('admission.confirm', { id: this.req.body.performanceId }));
            }
            else {
                this.res.redirect(this.router.build('admission.performances'));
            }
        }
        else {
            // 劇場とスクリーンを取得
            ttts_domain_1.Models.Theater.find({}, 'name', (err, theaters) => {
                if (err)
                    return this.next(err);
                ttts_domain_1.Models.Screen.find({}, 'name theater', (findScreenErr, screens) => {
                    if (findScreenErr)
                        return this.next(findScreenErr);
                    const screensByTheater = {};
                    for (const screen of screens) {
                        if (!screensByTheater.hasOwnProperty(screen.get('theater'))) {
                            screensByTheater[screen.get('theater')] = [];
                        }
                        screensByTheater[screen.get('theater')].push(screen);
                    }
                    this.res.render('admission/performances', {
                        FilmUtil: ttts_domain_3.FilmUtil,
                        theaters: theaters,
                        screensByTheater: screensByTheater
                    });
                });
            });
        }
    }
    /**
     * QRコード認証画面
     *
     * QRコードを読み取って結果を表示するための画面
     *
     * @memberOf AdmissionController
     */
    confirm() {
        ttts_domain_1.Models.Performance.findOne({ _id: this.req.params.id })
            .populate('film', 'name')
            .populate('screen', 'name')
            .populate('theater', 'name')
            .exec((err, performance) => {
            if (err)
                this.next(new Error('Message.UnexpectedError'));
            ttts_domain_1.Models.Reservation.find({
                performance: performance.get('_id'),
                status: ttts_domain_2.ReservationUtil.STATUS_RESERVED
            }, 'seat_code ticket_type_code ticket_type_name_ja ticket_type_name_en entered payment_no payment_seat_index').exec((findReservationErr, reservations) => {
                if (findReservationErr)
                    this.next(new Error('Message.UnexpectedError'));
                const reservationsById = {};
                const reservationIdsByQrStr = {};
                for (const reservation of reservations) {
                    reservationsById[reservation.get('_id').toString()] = reservation;
                    reservationIdsByQrStr[reservation.get('qr_str')] = reservation.get('_id').toString();
                }
                this.res.render('admission/confirm', {
                    performance: performance,
                    reservationsById: reservationsById,
                    reservationIdsByQrStr: reservationIdsByQrStr
                });
            });
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AdmissionController;