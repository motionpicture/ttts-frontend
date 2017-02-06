"use strict";
const BaseController_1 = require("../../BaseController");
const ttts_domain_1 = require("@motionpicture/ttts-domain");
const ttts_domain_2 = require("@motionpicture/ttts-domain");
const log4js = require("log4js");
class TelCancelController extends BaseController_1.default {
    execute() {
        this.logger = log4js.getLogger('cancel');
        // 予約IDリストをjson形式で受け取る
        let reservationIds = JSON.parse(this.req.body.reservationIds);
        if (Array.isArray(reservationIds)) {
            this.logger.info('removing reservation by tel_staff... tel:', this.req.telStaffUser.get('user_id'), 'reservationIds:', reservationIds);
            ttts_domain_1.Models.Reservation.remove({
                _id: { $in: reservationIds },
                purchaser_group: { $ne: ttts_domain_2.ReservationUtil.PURCHASER_GROUP_STAFF },
            }, (err) => {
                this.logger.info('reservation removed by tel_staff.', err, 'tel:', this.req.telStaffUser.get('user_id'), 'reservationIds:', reservationIds);
                if (err) {
                    this.res.json({
                        success: false,
                        message: err.message
                    });
                }
                else {
                    this.res.json({
                        success: true,
                        message: null
                    });
                }
            });
        }
        else {
            this.res.json({
                success: false,
                message: this.req.__('Message.UnexpectedError')
            });
        }
    }
    /**
     * 内部確保(作業用２の座席に変更する)
     */
    execute2sagyo() {
        this.logger = log4js.getLogger('cancel');
        // 予約IDリストをjson形式で受け取る
        let reservationIds = JSON.parse(this.req.body.reservationIds);
        if (!Array.isArray(reservationIds)) {
            this.res.json({ success: false, message: this.req.__('Message.UnexpectedError') });
            return;
        }
        ttts_domain_1.Models.Staff.findOne({
            user_id: "2016sagyo2"
        }, (err, staff) => {
            this.logger.info('staff found.', err, staff);
            if (err)
                return this.res.json({ success: false, message: err.message });
            this.logger.info('updating reservations...');
            ttts_domain_1.Models.Reservation.update({
                _id: { $in: reservationIds },
                purchaser_group: { $ne: ttts_domain_2.ReservationUtil.PURCHASER_GROUP_STAFF },
            }, {
                "status": ttts_domain_2.ReservationUtil.STATUS_RESERVED,
                "purchaser_group": ttts_domain_2.ReservationUtil.PURCHASER_GROUP_STAFF,
                "charge": 0,
                "ticket_type_charge": 0,
                "ticket_type_name_en": "Free",
                "ticket_type_name_ja": "無料",
                "ticket_type_code": "00",
                "staff": staff.get('_id'),
                "staff_user_id": staff.get('user_id'),
                "staff_email": staff.get('email'),
                "staff_name": staff.get('name'),
                "staff_signature": "system",
                "updated_user": "system",
                // "purchased_at": Date.now(), // 購入日更新しない
                "watcher_name_updated_at": null,
                "watcher_name": ""
            }, {
                multi: true
            }, (err, raw) => {
                this.logger.info('reservation 2sagyo by tel_staff.', err, raw, 'tel:', this.req.telStaffUser.get('user_id'), 'reservationIds:', reservationIds);
                if (err)
                    return this.res.json({ success: false, message: err.message });
                this.res.json({
                    success: true,
                    message: null
                });
            });
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TelCancelController;
