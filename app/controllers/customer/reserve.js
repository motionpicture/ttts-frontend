"use strict";
/**
 * 一般座席予約コントローラー
 *
 * @namespace controller/customer/reserve
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const GMO = require("@motionpicture/gmo-service");
const TTTS = require("@motionpicture/ttts-domain");
const conf = require("config");
const createDebug = require("debug");
//import * as httpStatus from 'http-status';
const moment = require("moment");
const _ = require("underscore");
const reservePaymentCreditForm_1 = require("../../forms/reserve/reservePaymentCreditForm");
const reservePerformanceForm_1 = require("../../forms/reserve/reservePerformanceForm");
const session_1 = require("../../models/reserve/session");
const reserveBaseController = require("../reserveBase");
const debug = createDebug('ttts-frontend:controller:customerReserve');
const PURCHASER_GROUP = TTTS.ReservationUtil.PURCHASER_GROUP_CUSTOMER;
/**
 * スケジュール選択(本番では存在しない、実際はポータル側のページ)
 * @method performances
 * @returns {Promise<void>}
 */
function performances(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            //const token: string = await getToken();
            const token = yield TTTS.CommonUtil.getToken(process.env.API_ENDPOINT);
            // tslint:disable-next-line:no-console
            // console.log('token=' + JSON.stringify(token));
            if (req.method === 'POST') {
                reservePerformanceForm_1.default(req);
                const validationResult = yield req.getValidationResult();
                if (!validationResult.isEmpty()) {
                    res.render('customer/reserve/performances');
                    return;
                }
                const performaceId = req.body.performanceId;
                res.redirect(`/customer/reserve/start?performance=${performaceId}&locale=${req.getLocale()}`);
                return;
            }
            else {
                res.render('staff/reserve/performances', {
                    // FilmUtil: TTTS.FilmUtil,
                    token: token
                });
            }
        }
        catch (error) {
            next(new Error(req.__('Message.UnexpectedError')));
        }
    });
}
exports.performances = performances;
/**
 * ポータルからパフォーマンスと言語指定で遷移してくる
 */
function start(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        // MPのIPは許可
        // tslint:disable-next-line:no-empty
        if (req.headers['x-forwarded-for'] !== undefined && /^124\.155\.113\.9$/.test(req.headers['x-forwarded-for'])) {
        }
        else {
            // 期限指定
            if (moment() < moment(conf.get('datetimes.reservation_start_customers_first'))) {
                if (!_.isEmpty(req.query.locale)) {
                    req.setLocale(req.query.locale);
                }
                next(new Error(req.__('Message.OutOfTerm')));
                return;
            }
            // 2次販売10分前より閉める
            if (moment() < moment(conf.get('datetimes.reservation_start_customers_second')) &&
                // tslint:disable-next-line:no-magic-numbers
                moment() > moment(conf.get('datetimes.reservation_start_customers_second')).add(-15, 'minutes')) {
                if (!_.isEmpty(req.query.locale)) {
                    req.setLocale(req.query.locale);
                }
                next(new Error(req.__('Message.OutOfTerm')));
                return;
            }
        }
        try {
            const reservationModel = yield reserveBaseController.processStart(PURCHASER_GROUP, req);
            if (reservationModel.performance !== undefined) {
                reservationModel.save(req);
                //2017/05/11 座席選択削除
                //res.redirect('/customer/reserve/terms');
                res.redirect('/customer/reserve/tickets');
                //---
            }
            else {
                // 今回は必ずパフォーマンス指定で遷移してくるはず
                next(new Error(req.__('Message.UnexpectedError')));
                // reservationModel.save(() => {
                //     res.redirect('/customer/reserve/performances');
                // });
            }
        }
        catch (error) {
            console.error(error);
            next(new Error(req.__('Message.UnexpectedError')));
        }
    });
}
exports.start = start;
/**
 * 券種選択
 */
function tickets(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const reservationModel = session_1.default.FIND(req);
            if (reservationModel === null) {
                next(new Error(req.__('Message.Expired')));
                return;
            }
            reservationModel.paymentMethod = '';
            if (req.method === 'POST') {
                // 仮予約あればキャンセルする
                try {
                    yield reserveBaseController.processCancelSeats(reservationModel);
                }
                catch (error) {
                    next(error);
                    return;
                }
                try {
                    // 予約処理
                    yield reserveBaseController.processFixSeatsAndTickets(reservationModel, req);
                    reservationModel.save(req);
                    res.redirect('/customer/reserve/profile');
                }
                catch (error) {
                    // "予約可能な席がございません"などのメッセージ表示
                    res.locals.message = error.message;
                    res.render('customer/reserve/tickets', {
                        reservationModel: reservationModel
                    });
                }
            }
            else {
                // 券種選択画面へ遷移
                res.locals.message = '';
                res.render('customer/reserve/tickets', {
                    reservationModel: reservationModel
                });
            }
        }
        catch (error) {
            next(new Error(req.__('Message.UnexpectedError')));
        }
    });
}
exports.tickets = tickets;
/**
 * 購入者情報
 */
function profile(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const reservationModel = session_1.default.FIND(req);
            if (reservationModel === null) {
                next(new Error(req.__('Message.Expired')));
                return;
            }
            if (req.method === 'POST') {
                try {
                    // 購入者情報FIXプロセス
                    yield reserveBaseController.processFixProfile(reservationModel, req, res);
                    // クレジットカード決済のオーソリ、あるいは、オーダーID発行
                    yield processFixGMO(reservationModel, req);
                    // 予約情報確定
                    yield reserveBaseController.processAllExceptConfirm(reservationModel, req);
                    reservationModel.save(req);
                    res.redirect('/customer/reserve/confirm');
                }
                catch (error) {
                    console.error(error);
                    res.render('customer/reserve/profile', {
                        reservationModel: reservationModel,
                        GMO_ENDPOINT: process.env.GMO_ENDPOINT,
                        GMO_SHOP_ID: process.env.GMO_SHOP_ID
                    });
                }
            }
            else {
                // セッションに情報があれば、フォーム初期値設定
                const email = reservationModel.purchaser.email;
                res.locals.lastName = reservationModel.purchaser.lastName;
                res.locals.firstName = reservationModel.purchaser.firstName;
                res.locals.tel = reservationModel.purchaser.tel;
                res.locals.age = reservationModel.purchaser.age;
                res.locals.address = reservationModel.purchaser.address;
                res.locals.gender = reservationModel.purchaser.gender;
                res.locals.email = (!_.isEmpty(email)) ? email : '';
                res.locals.emailConfirm = (!_.isEmpty(email)) ? email.substr(0, email.indexOf('@')) : '';
                res.locals.emailConfirmDomain = (!_.isEmpty(email)) ? email.substr(email.indexOf('@') + 1) : '';
                res.locals.paymentMethod =
                    (!_.isEmpty(reservationModel.paymentMethod)) ? reservationModel.paymentMethod : GMO.Util.PAY_TYPE_CREDIT;
                res.render('customer/reserve/profile', {
                    reservationModel: reservationModel,
                    GMO_ENDPOINT: process.env.GMO_ENDPOINT,
                    GMO_SHOP_ID: process.env.GMO_SHOP_ID
                });
            }
        }
        catch (error) {
            next(new Error(req.__('Message.UnexpectedError')));
        }
    });
}
exports.profile = profile;
/**
 * 予約内容確認
 */
function confirm(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const reservationModel = session_1.default.FIND(req);
            if (reservationModel === null) {
                next(new Error(req.__('Message.Expired')));
                return;
            }
            if (req.method === 'POST') {
                try {
                    // 仮押さえ有効期限チェック
                    if (reservationModel.expiredAt !== undefined && reservationModel.expiredAt < moment().valueOf()) {
                        throw new Error(req.__('Message.Expired'));
                    }
                    // クレジット以外の支払方法がある時はここにIf文が必要
                    //if (reservationModel.paymentMethod === GMO.Util.PAY_TYPE_CREDIT) {
                    // 予約確定
                    yield reserveBaseController.processFixReservations(reservationModel, reservationModel.performance.day, reservationModel.paymentNo, {}, res);
                    debug('processFixReservations processed.');
                    session_1.default.REMOVE(req);
                    res.redirect(`/customer/reserve/${reservationModel.performance.day}/${reservationModel.paymentNo}/complete`);
                    //}
                }
                catch (error) {
                    session_1.default.REMOVE(req);
                    next(error);
                }
            }
            else {
                res.render('customer/reserve/confirm', {
                    reservationModel: reservationModel
                });
            }
        }
        catch (error) {
            next(new Error(req.__('Message.UnexpectedError')));
        }
    });
}
exports.confirm = confirm;
/**
 * 仮予約完了
 */
function waitingSettlement(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const reservations = yield TTTS.Models.Reservation.find({
                performance_day: req.params.performanceDay,
                payment_no: req.params.paymentNo,
                purchaser_group: PURCHASER_GROUP,
                status: TTTS.ReservationUtil.STATUS_WAITING_SETTLEMENT,
                purchased_at: {
                    $gt: moment().add(-30, 'minutes').toISOString() // tslint:disable-line:no-magic-numbers
                }
            }).exec();
            if (reservations.length === 0) {
                next(new Error(req.__('Message.NotFound')));
                return;
            }
            reservations.sort((a, b) => {
                return TTTS.ScreenUtil.sortBySeatCode(a.get('seat_code'), b.get('seat_code'));
            });
            res.render('customer/reserve/waitingSettlement', {
                reservationDocuments: reservations
            });
        }
        catch (error) {
            next(new Error(req.__('Message.UnexpectedError')));
        }
    });
}
exports.waitingSettlement = waitingSettlement;
/**
 * 予約完了
 */
function complete(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const reservations = yield TTTS.Models.Reservation.find({
                performance_day: req.params.performanceDay,
                payment_no: req.params.paymentNo,
                purchaser_group: PURCHASER_GROUP,
                status: TTTS.ReservationUtil.STATUS_RESERVED,
                purchased_at: {
                    $gt: moment().add(-30, 'minutes').toISOString() // tslint:disable-line:no-magic-numbers
                }
            }).exec();
            if (reservations.length === 0) {
                next(new Error(req.__('Message.NotFound')));
                return;
            }
            reservations.sort((a, b) => {
                return TTTS.ScreenUtil.sortBySeatCode(a.get('seat_code'), b.get('seat_code'));
            });
            res.render('customer/reserve/complete', {
                reservationDocuments: reservations
            });
        }
        catch (error) {
            next(new Error(req.__('Message.UnexpectedError')));
        }
    });
}
exports.complete = complete;
/**
 * GMO決済FIXプロセス
 *
 * @param {ReserveSessionModel} reservationModel
 * @returns {Promise<void>}
 */
function processFixGMO(reservationModel, req) {
    return __awaiter(this, void 0, void 0, function* () {
        const DIGIT_OF_SERIAL_NUMBER_IN_ORDER_ID = -2;
        let orderId;
        if (reservationModel.transactionGMO === undefined) {
            reservationModel.transactionGMO = {
                orderId: '',
                accessId: '',
                accessPass: '',
                amount: 0,
                count: 0,
                status: GMO.Util.STATUS_CREDIT_UNPROCESSED
            };
        }
        // GMOリクエスト前にカウントアップ
        reservationModel.transactionGMO.count += 1;
        reservationModel.save(req);
        switch (reservationModel.paymentMethod) {
            case GMO.Util.PAY_TYPE_CREDIT:
                reservePaymentCreditForm_1.default(req);
                const validationResult = yield req.getValidationResult();
                if (!validationResult.isEmpty()) {
                    throw new Error(req.__('Message.Invalid'));
                }
                if (reservationModel.transactionGMO.status === GMO.Util.STATUS_CREDIT_AUTH) {
                    //GMOオーソリ取消
                    const alterTranIn = {
                        shopId: process.env.GMO_SHOP_ID,
                        shopPass: process.env.GMO_SHOP_PASS,
                        accessId: reservationModel.transactionGMO.accessId,
                        accessPass: reservationModel.transactionGMO.accessPass,
                        jobCd: GMO.Util.JOB_CD_VOID
                    };
                    yield GMO.CreditService.alterTran(alterTranIn);
                }
                // GMO取引作成
                const count = `00${reservationModel.transactionGMO.count}`.slice(DIGIT_OF_SERIAL_NUMBER_IN_ORDER_ID);
                // オーダーID 予約日 + 上映日 + 購入番号 + オーソリカウント(2桁)
                orderId = TTTS.ReservationUtil.createGMOOrderId(reservationModel.performance.day, reservationModel.paymentNo, count);
                debug('orderId:', orderId);
                const amount = reservationModel.getTotalCharge();
                const entryTranIn = {
                    shopId: process.env.GMO_SHOP_ID,
                    shopPass: process.env.GMO_SHOP_PASS,
                    orderId: orderId,
                    jobCd: GMO.Util.JOB_CD_AUTH,
                    amount: amount
                };
                const transactionGMO = yield GMO.CreditService.entryTran(entryTranIn);
                const gmoTokenObject = JSON.parse(req.body.gmoTokenObject);
                // GMOオーソリ
                const execTranIn = {
                    accessId: transactionGMO.accessId,
                    accessPass: transactionGMO.accessPass,
                    orderId: orderId,
                    method: GMO.Util.METHOD_LUMP,
                    token: gmoTokenObject.token
                };
                yield GMO.CreditService.execTran(execTranIn);
                reservationModel.transactionGMO.accessId = transactionGMO.accessId;
                reservationModel.transactionGMO.accessPass = transactionGMO.accessPass;
                reservationModel.transactionGMO.orderId = orderId;
                reservationModel.transactionGMO.amount = amount;
                reservationModel.transactionGMO.status = GMO.Util.STATUS_CREDIT_AUTH;
                break;
            case GMO.Util.PAY_TYPE_CVS:
                // コンビニ決済の場合、オーダーIDの発行だけ行う
                const serialNumber = `00${reservationModel.transactionGMO.count}`.slice(DIGIT_OF_SERIAL_NUMBER_IN_ORDER_ID);
                // オーダーID 予約日 + 上映日 + 購入番号 + オーソリカウント(2桁)
                orderId = TTTS.ReservationUtil.createGMOOrderId(reservationModel.performance.day, reservationModel.paymentNo, serialNumber);
                reservationModel.transactionGMO.orderId = orderId;
                break;
            default:
                break;
        }
    });
}
