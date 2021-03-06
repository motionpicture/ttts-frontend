"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.complete = exports.createEmail = exports.confirm = exports.profile = exports.tickets = exports.performances = exports.changeCategory = exports.start = void 0;
/**
 * 予約コントローラー
 */
const cinerinoapi = require("@cinerino/api-nodejs-client");
const conf = require("config");
const createDebug = require("debug");
const http_status_1 = require("http-status");
const jwt = require("jsonwebtoken");
const moment = require("moment-timezone");
const reservePaymentCreditForm_1 = require("../../forms/reserve/reservePaymentCreditForm");
const reservePerformanceForm_1 = require("../../forms/reserve/reservePerformanceForm");
const session_1 = require("../../models/reserve/session");
const reserveBaseController = require("../reserveBase");
const reserve_1 = require("../../factory/reserve");
const debug = createDebug('ttts-frontend:controller:customerReserve');
const reserveMaxDateInfo = conf.get('reserve_max_date');
const reservableEventStartFrom = moment(process.env.RESERVABLE_EVENT_START_FROM).toDate();
const authClient = new cinerinoapi.auth.ClientCredentials({
    domain: process.env.API_AUTHORIZE_SERVER_DOMAIN,
    clientId: process.env.API_CLIENT_ID,
    clientSecret: process.env.API_CLIENT_SECRET,
    scopes: [],
    state: ''
});
const placeOrderTransactionService = new cinerinoapi.service.transaction.PlaceOrder4ttts({
    endpoint: process.env.CINERINO_API_ENDPOINT,
    auth: authClient
});
const paymentService = new cinerinoapi.service.Payment({
    endpoint: process.env.CINERINO_API_ENDPOINT,
    auth: authClient
});
/**
 * 取引開始
 * waiter許可証を持って遷移してくる
 */
function start(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        // 必ずこれらのパラメータを持って遷移してくる
        if (typeof req.query.wc !== 'string' || req.query.wc.length === 0
            || typeof req.query.locale !== 'string' || req.query.locale.length === 0
            || typeof req.query.passportToken !== 'string' || req.query.passportToken.length === 0) {
            res.status(http_status_1.BAD_REQUEST).end('Bad Request');
            return;
        }
        debug('starting reserve...', req.query);
        try {
            // 購入結果セッション初期化
            delete req.session.transactionResult;
            delete req.session.printToken;
            const reservationModel = yield reserveBaseController.processStart(req);
            reservationModel.save(req);
            // パフォーマンス選択へ遷移
            res.redirect('/customer/reserve/performances');
        }
        catch (error) {
            debug('processStart failed.', error);
            if (Number.isInteger(error.code)) {
                if (error.code >= http_status_1.INTERNAL_SERVER_ERROR) {
                    // no op
                }
                else if (error.code >= http_status_1.BAD_REQUEST) {
                    res.status(http_status_1.BAD_REQUEST).end('Bad Request');
                    return;
                }
            }
            next(new Error(req.__('UnexpectedError')));
        }
    });
}
exports.start = start;
/**
 * 取引カテゴリーを変更する
 */
function changeCategory(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const reservationModel = session_1.default.FIND(req);
            if (reservationModel === null || moment(reservationModel.transactionInProgress.expires).toDate() <= moment().toDate()) {
                res.status(http_status_1.BAD_REQUEST);
                next(new Error(req.__('Expired')));
                return;
            }
            const category = req.params.category;
            if (category !== 'general' && category !== 'wheelchair') {
                res.status(http_status_1.BAD_REQUEST);
                next(new Error(req.__('UnexpectedError')));
                return;
            }
            // カテゴリーを変更してパフォーマンス選択へ遷移
            reservationModel.transactionInProgress.category = category;
            reservationModel.save(req);
            res.redirect('/customer/reserve/performances');
        }
        catch (error) {
            next(new Error(req.__('UnexpectedError')));
        }
    });
}
exports.changeCategory = changeCategory;
/**
 * スケジュール選択
 */
function performances(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const reservationModel = session_1.default.FIND(req);
            if (reservationModel === null || moment(reservationModel.transactionInProgress.expires).toDate() <= moment().toDate()) {
                res.status(http_status_1.BAD_REQUEST);
                next(new Error(req.__('Expired')));
                return;
            }
            // クライアントサイドで、パフォーマンス検索にapiのトークンを使用するので
            yield authClient.refreshAccessToken();
            const token = authClient.credentials;
            debug('api access token published.');
            const maxDate = moment();
            Object.keys(reserveMaxDateInfo).forEach((key) => {
                maxDate.add(reserveMaxDateInfo[key], key);
            });
            const reserveMaxDate = maxDate.format('YYYY/MM/DD');
            if (req.method === 'POST') {
                reservePerformanceForm_1.default(req);
                const validationResult = yield req.getValidationResult();
                if (validationResult.isEmpty()) {
                    // パフォーマンスfixして券種選択へ遷移
                    yield reserveBaseController.processFixPerformance(reservationModel, req.body.performanceId, req);
                    reservationModel.save(req);
                    res.redirect('/customer/reserve/tickets');
                    return;
                }
            }
            res.render('customer/reserve/performances', {
                token: token,
                reserveMaxDate: reserveMaxDate,
                reservableEventStartFrom: moment(reservableEventStartFrom).toISOString(),
                category: reservationModel.transactionInProgress.category
            });
        }
        catch (error) {
            next(new Error(req.__('UnexpectedError')));
        }
    });
}
exports.performances = performances;
/**
 * 券種選択
 */
function tickets(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const reservationModel = session_1.default.FIND(req);
            if (reservationModel === null || moment(reservationModel.transactionInProgress.expires).toDate() <= moment().toDate()) {
                res.status(http_status_1.BAD_REQUEST);
                next(new Error(req.__('Expired')));
                return;
            }
            // パフォーマンスは指定済みのはず
            if (reservationModel.transactionInProgress.performance === undefined) {
                throw new Error(req.__('UnexpectedError'));
            }
            reservationModel.transactionInProgress.paymentMethod = cinerinoapi.factory.paymentMethodType.CreditCard;
            res.locals.message = '';
            if (req.method === 'POST') {
                // 仮予約あればキャンセルする
                try {
                    // セッション中の予約リストを初期化
                    reservationModel.transactionInProgress.reservations = [];
                    // 座席仮予約があればキャンセル
                    if (reservationModel.transactionInProgress.seatReservationAuthorizeActionId !== undefined) {
                        debug('canceling seat reservation authorize action...');
                        const actionId = reservationModel.transactionInProgress.seatReservationAuthorizeActionId;
                        delete reservationModel.transactionInProgress.seatReservationAuthorizeActionId;
                        yield placeOrderTransactionService.voidSeatReservation({
                            id: actionId,
                            purpose: { typeOf: cinerinoapi.factory.transactionType.PlaceOrder, id: reservationModel.transactionInProgress.id }
                        });
                        debug('seat reservation authorize action canceled.');
                    }
                }
                catch (error) {
                    next(error);
                    return;
                }
                try {
                    // 現在時刻が開始時刻を過ぎている時
                    if (moment(reservationModel.transactionInProgress.performance.startDate).toDate() < moment().toDate()) {
                        //「ご希望の枚数が用意できないため予約できません。」
                        throw new Error(req.__('NoAvailableSeats'));
                    }
                    // 予約処理
                    yield reserveBaseController.processFixSeatsAndTickets(reservationModel, req);
                    reservationModel.save(req);
                    res.redirect('/customer/reserve/profile');
                    return;
                }
                catch (error) {
                    // "予約可能な席がございません"などのメッセージ表示
                    res.locals.message = error.message;
                    // 残席数不足、あるいは車椅子レート制限を超過の場合
                    if (error.code === http_status_1.CONFLICT || error.code === http_status_1.TOO_MANY_REQUESTS) {
                        res.locals.message = req.__('NoAvailableSeats');
                    }
                }
            }
            // 券種選択画面へ遷移
            res.render('customer/reserve/tickets', {
                reservationModel: reservationModel
            });
        }
        catch (error) {
            next(new Error(req.__('UnexpectedError')));
        }
    });
}
exports.tickets = tickets;
/**
 * 購入者情報
 */
// tslint:disable-next-line:max-func-body-length
function profile(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const reservationModel = session_1.default.FIND(req);
            if (reservationModel === null || moment(reservationModel.transactionInProgress.expires).toDate() <= moment().toDate()) {
                res.status(http_status_1.BAD_REQUEST);
                next(new Error(req.__('Expired')));
                return;
            }
            let gmoError = '';
            if (req.method === 'POST') {
                //Form入力値チェック
                const isValid = yield reserveBaseController.isValidProfile(req, res);
                //GMO処理
                if (isValid) {
                    try {
                        // 購入者情報FIXプロセス
                        yield reserveBaseController.processFixProfile(reservationModel, req);
                        try {
                            // クレジットカード決済のオーソリ、あるいは、オーダーID発行
                            yield processFixGMO(reservationModel, req);
                        }
                        catch (error) {
                            debug('failed in fixing GMO.', error.code, error);
                            if (error.code === http_status_1.BAD_REQUEST) {
                                throw new Error(req.__('BadCard'));
                                // いったん保留
                                // switch (e.errors[0].code) {
                                //     case 'E92':
                                //         // "只今、大変込み合っていますので、しばらく時間をあけて再度決済を行ってください。"
                                //         errMsg = req.__('TransactionBusy');
                                //         break;
                                //     case 'G02':
                                //         // "カード残高が不足しているために、決済を完了する事が出来ませんでした。"
                                //         errMsg = req.__('InsufficientCard');
                                //         break;
                                //     case 'G03':
                                //         // "カード限度額を超えているために、決済を完了する事が出来ませんでした。"
                                //         errMsg = req.__('MaxedCard');
                                //         break;
                                //     case 'G04':
                                //         // "カード残高が不足しているために、決済を完了する事が出来ませんでした。"
                                //         errMsg = req.__('InsufficientCard');
                                //         break;
                                //     case 'G05':
                                //         // "カード限度額を超えているために、決済を完了する事が出来ませんでした。"
                                //         errMsg = req.__('MaxedCard');
                                //         break;
                                //     default:
                                //         // "このカードでは取引をする事が出来ません。"
                                //         errMsg = req.__('BadCard');
                                //         break;
                                // }
                            }
                            throw new Error(req.__('UnexpectedError'));
                        }
                        reservationModel.save(req);
                        res.redirect('/customer/reserve/confirm');
                        return;
                    }
                    catch (error) {
                        gmoError = error.message;
                    }
                }
            }
            else {
                // セッションに情報があれば、フォーム初期値設定
                const email = reservationModel.transactionInProgress.purchaser.email;
                res.locals.lastName = reservationModel.transactionInProgress.purchaser.lastName;
                res.locals.firstName = reservationModel.transactionInProgress.purchaser.firstName;
                res.locals.tel = reservationModel.transactionInProgress.purchaser.tel;
                res.locals.age = reservationModel.transactionInProgress.purchaser.age;
                res.locals.address = reservationModel.transactionInProgress.purchaser.address;
                res.locals.gender = reservationModel.transactionInProgress.purchaser.gender;
                res.locals.email = (typeof email === 'string') ? email : '';
                res.locals.emailConfirm = (typeof email === 'string') ? email.substr(0, email.indexOf('@')) : '';
                res.locals.emailConfirmDomain = (typeof email === 'string') ? email.substr(email.indexOf('@') + 1) : '';
                res.locals.paymentMethod =
                    (typeof reservationModel.transactionInProgress.paymentMethod === 'string'
                        && reservationModel.transactionInProgress.paymentMethod.length > 0)
                        ? reservationModel.transactionInProgress.paymentMethod
                        : cinerinoapi.factory.paymentMethodType.CreditCard;
            }
            let gmoShopId = '';
            // 販売者情報からクレジットカード情報を取り出す
            const paymentAccepted = reservationModel.transactionInProgress.seller.paymentAccepted;
            if (paymentAccepted !== undefined) {
                const creditCardPaymentAccepted = paymentAccepted.find((p) => p.paymentMethodType === cinerinoapi.factory.paymentMethodType.CreditCard);
                if (creditCardPaymentAccepted !== undefined) {
                    gmoShopId = creditCardPaymentAccepted.gmoInfo.shopId;
                }
            }
            res.render('customer/reserve/profile', {
                reservationModel: reservationModel,
                GMO_ENDPOINT: process.env.GMO_ENDPOINT,
                GMO_SHOP_ID: gmoShopId,
                gmoError: gmoError
            });
        }
        catch (error) {
            next(new Error(req.__('UnexpectedError')));
        }
    });
}
exports.profile = profile;
/**
 * 注文確定
 */
// tslint:disable-next-line:max-func-body-length
function confirm(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const reservationModel = session_1.default.FIND(req);
            if (reservationModel === null || moment(reservationModel.transactionInProgress.expires).toDate() <= moment().toDate()) {
                res.status(http_status_1.BAD_REQUEST);
                next(new Error(req.__('Expired')));
                return;
            }
            if (req.method === 'POST') {
                try {
                    // 購入番号発行
                    if (reservationModel.transactionInProgress.performance === undefined) {
                        throw new cinerinoapi.factory.errors.Argument('Transaction', 'Event required');
                    }
                    // メール作成
                    const emailAttributes = createEmail(reservationModel, res);
                    // 予約確定
                    const transactionResult = yield placeOrderTransactionService.confirm({
                        id: reservationModel.transactionInProgress.id,
                        potentialActions: {
                            order: {
                                potentialActions: {
                                    sendOrder: {
                                        potentialActions: {
                                            sendEmailMessage: [{
                                                    object: {
                                                        sender: {
                                                            name: emailAttributes.sender.name,
                                                            email: emailAttributes.sender.email
                                                        },
                                                        toRecipient: {
                                                            name: emailAttributes.toRecipient.name,
                                                            email: emailAttributes.toRecipient.email
                                                        },
                                                        about: emailAttributes.about,
                                                        template: emailAttributes.text
                                                    }
                                                }]
                                        }
                                    }
                                }
                            }
                        }
                    });
                    debug('transacion confirmed. orderNumber:', transactionResult.order.orderNumber);
                    let paymentNo = '';
                    if (Array.isArray(transactionResult.order.identifier)) {
                        const paymentNoProperty = transactionResult.order.identifier.find((p) => p.name === 'paymentNo');
                        if (paymentNoProperty !== undefined) {
                            paymentNo = paymentNoProperty.value;
                        }
                    }
                    // 印刷トークン生成
                    const reservationIds = transactionResult.order.acceptedOffers.map((o) => o.itemOffered.id);
                    const printToken = yield createPrintToken(reservationIds);
                    // 購入結果セッション作成
                    req.session.transactionResult = Object.assign(Object.assign({}, transactionResult), { printToken, paymentNo });
                    // 購入フローセッションは削除
                    session_1.default.REMOVE(req);
                    res.redirect('/customer/reserve/complete');
                    return;
                }
                catch (error) {
                    session_1.default.REMOVE(req);
                    // 万が一注文番号が重複すると、ステータスコードCONFLICTが返却される
                    if (error.code === http_status_1.CONFLICT) {
                        next(new Error(req.__('CouldNotReserve')));
                    }
                    else {
                        next(error);
                    }
                    return;
                }
            }
            // チケットを券種コードでソート
            sortReservationstByTicketType(reservationModel.transactionInProgress.reservations);
            res.render('customer/reserve/confirm', {
                reservationModel: reservationModel
            });
        }
        catch (error) {
            next(new Error(req.__('UnexpectedError')));
        }
    });
}
exports.confirm = confirm;
function createEmail(
// paymentNo: string,
reservationModel, res) {
    // 予約連携パラメータ作成
    const customerProfile = reservationModel.transactionInProgress.profile;
    if (customerProfile === undefined) {
        throw new Error('No Customer Profile');
    }
    const event = reservationModel.transactionInProgress.performance;
    if (event === undefined) {
        throw new cinerinoapi.factory.errors.Argument('Transaction', 'Event required');
    }
    const price = reservationModel.getTotalCharge();
    const ticketTypes = reservationModel.transactionInProgress.ticketTypes
        .filter((t) => Number(t.count) > 0);
    // 完了メール作成
    return reserve_1.createEmailAttributes(event, customerProfile, 
    // paymentNo,
    price, ticketTypes, res);
}
exports.createEmail = createEmail;
/**
 * 予約印刷トークンを発行する
 */
function createPrintToken(object) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            const payload = {
                object: object
            };
            jwt.sign(payload, process.env.TTTS_TOKEN_SECRET, (jwtErr, token) => {
                if (jwtErr instanceof Error) {
                    reject(jwtErr);
                }
                else {
                    resolve(token);
                }
            });
        });
    });
}
/**
 * 予約完了
 */
function complete(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // セッションに取引結果があるはず
            const transactionResult = req.session.transactionResult;
            if (transactionResult === undefined) {
                res.status(http_status_1.NOT_FOUND);
                next(new Error(req.__('NotFound')));
                return;
            }
            const reservations = transactionResult.order.acceptedOffers
                .map((o) => {
                const unitPrice = reserveBaseController.getUnitPriceByAcceptedOffer(o);
                return Object.assign(Object.assign({}, o.itemOffered), { unitPrice: unitPrice });
            });
            // チケットを券種コードでソート
            sortReservationstByTicketType(reservations);
            res.render('customer/reserve/complete', {
                order: transactionResult.order,
                reservations: reservations,
                paymentNo: transactionResult.paymentNo,
                printToken: transactionResult.printToken
            });
        }
        catch (error) {
            next(new Error(req.__('UnexpectedError')));
        }
    });
}
exports.complete = complete;
/**
 * GMO決済FIXプロセス
 */
function processFixGMO(reservationModel, req) {
    return __awaiter(this, void 0, void 0, function* () {
        // パフォーマンスは指定済みのはず
        if (reservationModel.transactionInProgress.performance === undefined) {
            throw new Error(req.__('UnexpectedError'));
        }
        // GMOリクエスト前にカウントアップ
        reservationModel.transactionInProgress.transactionGMO.count += 1;
        reservationModel.save(req);
        switch (reservationModel.transactionInProgress.paymentMethod) {
            case cinerinoapi.factory.paymentMethodType.CreditCard:
                reservePaymentCreditForm_1.default(req);
                const validationResult = yield req.getValidationResult();
                if (!validationResult.isEmpty()) {
                    throw new Error(req.__('Invalid'));
                }
                // クレジットカードオーソリ取得済であれば取消
                if (reservationModel.transactionInProgress.creditCardAuthorizeActionId !== undefined) {
                    debug('canceling credit card authorization...', reservationModel.transactionInProgress.creditCardAuthorizeActionId);
                    const actionId = reservationModel.transactionInProgress.creditCardAuthorizeActionId;
                    delete reservationModel.transactionInProgress.creditCardAuthorizeActionId;
                    yield paymentService.voidTransaction({
                        id: actionId,
                        object: {
                            typeOf: cinerinoapi.factory.paymentMethodType.CreditCard
                        },
                        purpose: {
                            typeOf: cinerinoapi.factory.transactionType.PlaceOrder,
                            id: reservationModel.transactionInProgress.id
                        }
                    });
                    debug('credit card authorization canceled.');
                }
                const gmoTokenObject = JSON.parse(req.body.gmoTokenObject);
                const amount = reservationModel.getTotalCharge();
                // クレジットカードオーソリ取得
                debug('creating credit card authorizeAction...');
                const action = yield paymentService.authorizeCreditCard({
                    object: {
                        typeOf: cinerinoapi.factory.paymentMethodType.CreditCard,
                        amount: amount,
                        // tslint:disable-next-line:no-suspicious-comment
                        method: '1',
                        creditCard: gmoTokenObject
                    },
                    purpose: {
                        typeOf: cinerinoapi.factory.transactionType.PlaceOrder,
                        id: reservationModel.transactionInProgress.id
                    }
                });
                debug('credit card authorizeAction created.', action.id);
                reservationModel.transactionInProgress.creditCardAuthorizeActionId = action.id;
                reservationModel.transactionInProgress.paymentMethodId = action.object.paymentMethodId;
                reservationModel.transactionInProgress.transactionGMO.amount = amount;
                break;
            default:
        }
    });
}
/**
 * チケットを券種コードでソートする
 */
function sortReservationstByTicketType(reservations) {
    reservations.sort((a, b) => {
        // 入塔日
        if (a.reservedTicket.ticketType.identifier > b.reservedTicket.ticketType.identifier) {
            return 1;
        }
        if (a.reservedTicket.ticketType.identifier < b.reservedTicket.ticketType.identifier) {
            return -1;
        }
        return 0;
    });
}
