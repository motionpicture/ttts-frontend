"use strict";
const BaseController_1 = require("../../BaseController");
const Util_1 = require("../../../../common/Util/Util");
const ReservationUtil_1 = require("../../../../common/models/Reservation/ReservationUtil");
const ScreenUtil_1 = require("../../../../common/models/Screen/ScreenUtil");
const Models_1 = require("../../../../common/models/Models");
class SponsorMyPageController extends BaseController_1.default {
    constructor() {
        super(...arguments);
        this.layout = 'layouts/sponsor/layout';
    }
    index() {
        this.res.render('sponsor/mypage/index');
    }
    /**
     * マイページ予約検索
     */
    search() {
        let limit = (this.req.query.limit) ? parseInt(this.req.query.limit) : 10;
        let page = (this.req.query.page) ? parseInt(this.req.query.page) : 1;
        let tel = (this.req.query.tel) ? this.req.query.tel : null;
        let purchaserName = (this.req.query.purchaser_name) ? this.req.query.purchaser_name : null;
        let paymentNo = (this.req.query.payment_no) ? this.req.query.payment_no : null;
        // 検索条件を作成
        let conditions = [];
        conditions.push({
            purchaser_group: ReservationUtil_1.default.PURCHASER_GROUP_SPONSOR,
            sponsor: this.req.sponsorUser.get('_id'),
            status: ReservationUtil_1.default.STATUS_RESERVED
        });
        if (tel) {
            conditions.push({
                $or: [
                    {
                        purchaser_tel: { $regex: `${tel}` }
                    }
                ]
            });
        }
        if (purchaserName) {
            conditions.push({
                $or: [
                    {
                        purchaser_last_name: { $regex: `${purchaserName}` }
                    },
                    {
                        purchaser_first_name: { $regex: `${purchaserName}` }
                    }
                ]
            });
        }
        if (paymentNo) {
            // remove space characters
            paymentNo = Util_1.default.toHalfWidth(paymentNo.replace(/\s/g, ''));
            conditions.push({ payment_no: { $regex: `${paymentNo}` } });
        }
        // 総数検索
        Models_1.default.Reservation.count({
            $and: conditions
        }, (err, count) => {
            if (err) {
                return this.res.json({
                    success: false,
                    results: [],
                    count: 0
                });
            }
            Models_1.default.Reservation.find({ $and: conditions })
                .skip(limit * (page - 1))
                .limit(limit)
                .lean(true)
                .exec((err, reservations) => {
                if (err) {
                    this.res.json({
                        success: false,
                        results: [],
                        count: 0
                    });
                }
                else {
                    // ソート昇順(上映日→開始時刻→スクリーン→座席コード)
                    reservations.sort((a, b) => {
                        if (a.performance_day > b.performance_day)
                            return 1;
                        if (a.performance_start_time > b.performance_start_time)
                            return 1;
                        if (a.screen > b.screen)
                            return 1;
                        return ScreenUtil_1.default.sortBySeatCode(a.seat_code, b.seat_code);
                    });
                    this.res.json({
                        success: true,
                        results: reservations,
                        count: count
                    });
                }
            });
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SponsorMyPageController;
