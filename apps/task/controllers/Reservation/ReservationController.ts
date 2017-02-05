import BaseController from '../BaseController';
import Models from '../../../common/models/Models';
import ReservationUtil from '../../../common/models/Reservation/ReservationUtil';
import GMOUtil from '../../../common/Util/GMO/GMOUtil';
import moment = require('moment');
import conf = require('config');
import mongoose = require('mongoose');
import request = require('request');
import querystring = require('querystring');

let MONGOLAB_URI = conf.get<string>('mongolab_uri');

export default class ReservationController extends BaseController {
    /**
     * 仮予約ステータスで、一定時間過ぎた予約を空席にする
     */
    public removeTmps(): void {
        mongoose.connect(MONGOLAB_URI, {});

        this.logger.info('removing temporary reservations...');
        Models.Reservation.remove(
            {
                status: ReservationUtil.STATUS_TEMPORARY,
                expired_at: {
                    // 念のため、仮予約有効期間より1分長めにしておく
                    $lt: moment().add(-60, 'seconds').toISOString()
                }
            },
            (err) => {
                this.logger.info('temporary reservations removed.', err);

                // 失敗しても、次のタスクにまかせる(気にしない)
                if (err) {
                }

                mongoose.disconnect();
                process.exit(0);
            }
        );
    }

    /**
     * TTTS確保上の仮予約をTTTS確保へ戻す
     */
    public tmp2tiff(): void {
        mongoose.connect(MONGOLAB_URI, {});

        Models.Reservation.distinct(
            '_id',
            {
                status: ReservationUtil.STATUS_TEMPORARY_ON_KEPT_BY_TTTS,
                expired_at: {
                    // 念のため、仮予約有効期間より1分長めにしておく
                    $lt: moment().add(-60, 'seconds').toISOString()
                }
            },
            (err, ids) => {
                if (err) {
                    mongoose.disconnect();
                    process.exit(0);
                }

                let promises = ids.map((id) => {
                    return new Promise((resolve, reject) => {
                        this.logger.info('updating to STATUS_KEPT_BY_TTTS...id:', id);
                        Models.Reservation.findOneAndUpdate(
                            {_id: id},
                            {status: ReservationUtil.STATUS_KEPT_BY_TTTS},
                            {new: true},
                            (err, reservation) => {
                                this.logger.info('updated to STATUS_KEPT_BY_TTTS. id:', id, err, reservation);
                                (err) ? reject(err) : resolve();
                            }
                        );
                    });
                });

                Promise.all(promises).then(() => {
                    mongoose.disconnect();
                    process.exit(0);
                }, () => {
                    // 失敗しても、次のタスクにまかせる(気にしない)
                    mongoose.disconnect();
                    process.exit(0);
                });
            }
        );
    }

    /**
     * 固定日時を経過したら、空席ステータスにするバッチ
     */
    public releaseSeatsKeptByMembers() {
        if (moment(conf.get<string>('datetimes.reservation_end_members')) < moment()) {
            mongoose.connect(MONGOLAB_URI);


            // 内部関係者で確保する
            Models.Staff.findOne({
                user_id: "2016sagyo2"
            }, (err, staff) => {
                this.logger.info('staff found.', err, staff);
                if (err) {
                    mongoose.disconnect();
                    process.exit(0);
                    return;
                }

                // 購入番号発行
                ReservationUtil.publishPaymentNo((err, paymentNo) => {
                    this.logger.info('paymentNo is', paymentNo);
                    if (err) {
                        mongoose.disconnect();
                        process.exit(0);
                        return;
                    }


                    Models.Reservation.find({
                        status: ReservationUtil.STATUS_KEPT_BY_MEMBER
                    }, (err, reservations) => {
                        if (err) {
                            mongoose.disconnect();
                            process.exit(0);
                            return;
                        }

                        let promises = reservations.map((reservation, index) => {
                            return new Promise((resolve, reject) => {
                                this.logger.info('finding performance...');
                                Models.Performance.findOne({
                                    _id: reservation.get('performance')
                                })
                                .populate('film', 'name is_mx4d copyright')
                                .populate('screen', 'name')
                                .populate('theater', 'name address')
                                .exec((err, performance) => {
                                    if (err) return reject(err);

                                    this.logger.info('updating reservation...');
                                    reservation.update({
                                        "status": ReservationUtil.STATUS_RESERVED,
                                        "staff": staff.get('_id'),
                                        "staff_user_id": staff.get('user_id'),
                                        "staff_email": staff.get('email'),
                                        "staff_name": staff.get('name'),
                                        "staff_signature": "system",
                                        "entered": false,
                                        "updated_user": "system",
                                        "purchased_at": Date.now(),
                                        "watcher_name_updated_at": null,
                                        "watcher_name": "",
                                        "film_copyright": performance.get('film').get('copyright'),
                                        "film_is_mx4d": performance.get('film').get('is_mx4d'),
                                        "film_image": `https://${conf.get<string>('dns_name')}/images/film/${performance.get('film').get('_id')}.jpg`,
                                        "film_name_en": performance.get('film').get('name.en'),
                                        "film_name_ja": performance.get('film').get('name.ja'),
                                        "film": performance.get('film').get('_id'),
                                        "screen_name_en": performance.get('screen').get('name.en'),
                                        "screen_name_ja": performance.get('screen').get('name.ja'),
                                        "screen": performance.get('screen').get('_id'),
                                        "theater_name_en": performance.get('theater').get('name.en'),
                                        "theater_name_ja": performance.get('theater').get('name.ja'),
                                        "theater_address_en": performance.get('theater').get('address.en'),
                                        "theater_address_ja": performance.get('theater').get('address.ja'),
                                        "theater": performance.get('theater').get('_id'),
                                        "performance_canceled": performance.get('canceled'),
                                        "performance_end_time": performance.get('end_time'),
                                        "performance_start_time": performance.get('start_time'),
                                        "performance_open_time": performance.get('open_time'),
                                        "performance_day": performance.get('day'),
                                        "purchaser_group": ReservationUtil.PURCHASER_GROUP_STAFF,
                                        "payment_no": paymentNo,
                                        "payment_seat_index": index,
                                        "charge": 0,
                                        "ticket_type_charge": 0,
                                        "ticket_type_name_en": "Free",
                                        "ticket_type_name_ja": "無料",
                                        "ticket_type_code": "00",
                                        "seat_grade_additional_charge": 0,
                                        "seat_grade_name_en": "Normal Seat",
                                        "seat_grade_name_ja": "ノーマルシート"
                                    }, (err, raw) => {
                                        this.logger.info('reservation updated.', err, raw);
                                        (err) ? reject(err) : resolve();
                                    });
                                });
                            });
                        });

                        Promise.all(promises).then(() => {
                            this.logger.info('promised.', err);
                            mongoose.disconnect();
                            process.exit(0);
                        }).catch((err) => {
                            this.logger.info('promised.', err);
                            mongoose.disconnect();
                            process.exit(0);
                        });
                    });
                });
            });





            // 空席にする場合はこちら
            // this.logger.info('releasing reservations kept by members...');
            // Models.Reservation.remove(
            //     {
            //         status: ReservationUtil.STATUS_KEPT_BY_MEMBER
            //     },
            //     (err) => {
            //         // 失敗しても、次のタスクにまかせる(気にしない)
            //         if (err) {
            //         } else {
            //         }

            //         mongoose.disconnect();
            //         process.exit(0);
            //     }
            // );
        } else {
            process.exit(0);
        }
    }

    /**
     * GMO離脱データを解放する(内部確保)
     */
    public releaseGarbages(): void {
        mongoose.connect(MONGOLAB_URI);

        // 一定期間WAITING_SETTLEMENTの予約を抽出
        Models.Reservation.find({
            status: ReservationUtil.STATUS_WAITING_SETTLEMENT,
            updated_at: {$lt: moment().add(-2, 'hours').toISOString()}
        }, (err, reservations) => {
            this.logger.info('reservations found.', err, reservations);
            if (err) {
                mongoose.disconnect();
                process.exit(0);
                return;
            }

            let paymentNos4release = [];
            let gmoUrl = (process.env.NODE_ENV === "prod") ? "https://p01.mul-pay.jp/payment/SearchTradeMulti.idPass" : "https://pt01.mul-pay.jp/payment/SearchTradeMulti.idPass";

            let promises = reservations.map((reservation) => {
                return new Promise((resolve, reject) => {
                    // GMO取引状態参照
                    this.logger.info('requesting... ');
                    request.post({
                        url: gmoUrl,
                        form: {
                            ShopID: conf.get<string>('gmo_payment_shop_id'),
                            ShopPass: conf.get<string>('gmo_payment_shop_password'),
                            OrderID: reservation.get('payment_no'),
                            PayType: reservation.get('payment_method')
                        }
                    }, (error, response, body) => {
                        this.logger.info('request processed.', error);
                        if (error) return reject(error);
                        if (response.statusCode !== 200) return reject(new Error(`statusCode is ${response.statusCode}`));

                        let searchTradeResult = querystring.parse(body);

                        // GMOにない、あるいは、UNPROCESSEDであれば離脱データ
                        if (searchTradeResult['ErrCode']) {
                            // M01-M01004002
                            // 指定されたオーダーIDの取引は登録されていません。
                            if (searchTradeResult['ErrCode'] === 'M01' && searchTradeResult['ErrInfo'] === 'M01004002') {
                                paymentNos4release.push(reservation.get('payment_no'));
                            }

                            resolve();
                        } else {
                            if (searchTradeResult.Status === GMOUtil.STATUS_CVS_UNPROCESSED || searchTradeResult.Status === GMOUtil.STATUS_CREDIT_UNPROCESSED) {
                                paymentNos4release.push(reservation.get('payment_no'));
                            }

                            resolve();
                        }
                    });
                });
            });

            Promise.all(promises).then(() => {
                this.logger.info('promised.');

                if (paymentNos4release.length === 0) {
                    mongoose.disconnect();
                    process.exit(0);
                    return;
                }

                // 内部で確保する仕様の場合
                Models.Staff.findOne({
                    user_id: "2016sagyo2"
                }, (err, staff) => {
                    this.logger.info('staff found.', err, staff);
                    if (err) {
                        mongoose.disconnect();
                        process.exit(0);
                        return;
                    }


                    this.logger.info('updating reservations...');
                    Models.Reservation.update({
                        payment_no: {$in: paymentNos4release}
                    }, {
                        "status": ReservationUtil.STATUS_RESERVED,
                        "purchaser_group": ReservationUtil.PURCHASER_GROUP_STAFF,

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
                        this.logger.info('updated.', err, raw);
                        mongoose.disconnect();
                        process.exit(0);
                    });
                });
            }).catch((err) => {
                this.logger.info('promised.', err);
                mongoose.disconnect();
                process.exit(0);
            });
        });
    }
}
