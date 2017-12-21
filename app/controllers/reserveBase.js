"use strict";
/**
 * 座席予約ベースコントローラー
 * @namespace controller/reserveBase
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
const ttts = require("@motionpicture/ttts-domain");
const conf = require("config");
const createDebug = require("debug");
const moment = require("moment");
const numeral = require("numeral");
const _ = require("underscore");
const reserveProfileForm_1 = require("../forms/reserve/reserveProfileForm");
const reserveTicketForm_1 = require("../forms/reserve/reserveTicketForm");
const session_1 = require("../models/reserve/session");
const debug = createDebug('ttts-frontend:controller:reserveBase');
// 車椅子レート制限のためのRedis接続クライアント
const redisClient = ttts.redis.createClient({
    host: process.env.REDIS_HOST,
    // tslint:disable-next-line:no-magic-numbers
    port: parseInt(process.env.REDIS_PORT, 10),
    password: process.env.REDIS_KEY,
    tls: { servername: process.env.REDIS_HOST }
});
/**
 * 座席・券種FIXプロセス
 *
 * @param {ReserveSessionModel} reservationModel
 * @returns {Promise<void>}
 */
// tslint:disable-next-line:max-func-body-length
function processFixSeatsAndTickets(reservationModel, req) {
    return __awaiter(this, void 0, void 0, function* () {
        // 検証(券種が選択されていること)+チケット枚数合計計算
        const checkInfo = yield checkFixSeatsAndTickets(reservationModel, req);
        if (!checkInfo.status) {
            throw new Error(checkInfo.message);
        }
        // 予約可能件数チェック+予約情報取得
        const infos = yield getInfoFixSeatsAndTickets(reservationModel, req, Number(checkInfo.selectedCount) + Number(checkInfo.extraCount));
        if (infos.status === false) {
            throw new Error(infos.message);
        }
        // チケット情報に枚数セット(画面で選択された枚数<画面再表示用)
        reservationModel.transactionInProgress.ticketTypes.forEach((ticketType) => {
            const choice = checkInfo.choices.find((c) => ticketType.id === c.ticket_type);
            ticketType.count = (choice !== undefined) ? Number(choice.ticket_count) : 0;
        });
        // セッション中の予約リストを初期化
        reservationModel.transactionInProgress.reservations = [];
        // 座席承認アクション
        const offers = checkInfo.choicesAll.map((choice) => {
            // チケット情報
            const ticketType = reservationModel.transactionInProgress.ticketTypes.find((t) => (t.id === choice.ticket_type));
            if (ticketType === undefined) {
                throw new Error(req.__('UnexpectedError'));
            }
            return {
                ticket_type: ticketType.id,
                watcher_name: ''
            };
        });
        debug(`creating seatReservation authorizeAction on ${offers.length} offers...`);
        const action = yield ttts.service.transaction.placeOrderInProgress.action.authorize.seatReservation.create(reservationModel.transactionInProgress.agentId, reservationModel.transactionInProgress.id, reservationModel.transactionInProgress.performance.id, offers)(new ttts.repository.Transaction(ttts.mongoose.connection), new ttts.repository.Performance(ttts.mongoose.connection), new ttts.repository.action.authorize.SeatReservation(ttts.mongoose.connection), new ttts.repository.PaymentNo(ttts.mongoose.connection), new ttts.repository.rateLimit.TicketTypeCategory(redisClient));
        reservationModel.transactionInProgress.seatReservationAuthorizeActionId = action.id;
        // この時点で購入番号が発行される
        reservationModel.transactionInProgress.paymentNo =
            action.result.tmpReservations[0].payment_no;
        const tmpReservations = action.result.tmpReservations;
        // セッションに保管
        reservationModel.transactionInProgress.reservations = tmpReservations.filter((r) => r.status_after === ttts.factory.reservationStatusType.ReservationConfirmed);
        // tslint:disable-next-line:no-suspicious-comment
        // TODO ソート
        // reservationModel.transactionInProgress.reservations.sort(ttts.factory.place.screen.sortBySeatCode);
    });
}
exports.processFixSeatsAndTickets = processFixSeatsAndTickets;
/**
 * 座席・券種FIXプロセス/検証処理
 *
 * @param {ReservationModel} reservationModel
 * @param {Request} req
 * @returns {Promise<void>}
 */
function checkFixSeatsAndTickets(reservationModel, req) {
    return __awaiter(this, void 0, void 0, function* () {
        const checkInfo = {
            status: false,
            choices: [],
            choicesAll: [],
            selectedCount: 0,
            extraCount: 0,
            message: ''
        };
        // 検証(券種が選択されていること)
        reserveTicketForm_1.default(req);
        const validationResult = yield req.getValidationResult();
        if (!validationResult.isEmpty()) {
            checkInfo.message = req.__('Invalid"');
            return checkInfo;
        }
        // 画面から座席選択情報が生成できなければエラー
        const choices = JSON.parse(req.body.choices);
        if (!Array.isArray(choices)) {
            checkInfo.message = req.__('UnexpectedError');
            return checkInfo;
        }
        checkInfo.choices = choices;
        // 特殊チケット情報
        const extraSeatNum = {};
        reservationModel.transactionInProgress.ticketTypes.forEach((ticketTypeInArray) => {
            if (ticketTypeInArray.ttts_extension.category !== ttts.factory.ticketTypeCategory.Normal) {
                extraSeatNum[ticketTypeInArray.id] = ticketTypeInArray.ttts_extension.required_seat_num;
            }
        });
        // チケット枚数合計計算
        choices.forEach((choice) => {
            // チケットセット(選択枚数分)
            checkInfo.selectedCount += Number(choice.ticket_count);
            for (let index = 0; index < Number(choice.ticket_count); index += 1) {
                const choiceInfo = {
                    ticket_type: choice.ticket_type,
                    ticketCount: 1,
                    choicesExtra: [],
                    updated: false
                };
                // 特殊の時、必要枚数分セット
                if (extraSeatNum.hasOwnProperty(choice.ticket_type)) {
                    const extraCount = Number(extraSeatNum[choice.ticket_type]) - 1;
                    for (let indexExtra = 0; indexExtra < extraCount; indexExtra += 1) {
                        choiceInfo.choicesExtra.push({
                            ticket_type: choice.ticket_type,
                            ticketCount: 1,
                            updated: false
                        });
                        checkInfo.extraCount += 1;
                    }
                }
                // 選択チケット本体分セット(選択枚数分)
                checkInfo.choicesAll.push(choiceInfo);
            }
        });
        checkInfo.status = true;
        return checkInfo;
    });
}
/**
 * 座席・券種FIXプロセス/予約情報取得処理
 *
 * @param {ReservationModel} reservationModel
 * @param {Request} req
 * @param {number} selectedCount
 * @returns {Promise<void>}
 */
function getInfoFixSeatsAndTickets(reservationModel, req, selectedCount) {
    return __awaiter(this, void 0, void 0, function* () {
        const stockRepo = new ttts.repository.Stock(ttts.mongoose.connection);
        const info = {
            status: false,
            results: null,
            message: ''
        };
        // 予約可能件数取得
        const conditions = {
            performance: reservationModel.transactionInProgress.performance.id,
            availability: ttts.factory.itemAvailability.InStock
        };
        const count = yield stockRepo.stockModel.count(conditions).exec();
        // チケット枚数より少ない場合は、購入不可としてリターン
        if (count < selectedCount) {
            // "予約可能な席がございません"
            info.message = req.__('NoAvailableSeats');
            return info;
        }
        // 予約情報取得
        const stocks = yield stockRepo.stockModel.find(conditions).exec();
        info.results = stocks.map((stock) => {
            return {
                id: stock.id,
                performance: stock.performance,
                seat_code: stock.seat_code,
                used: false
            };
        });
        // チケット枚数より少ない場合は、購入不可としてリターン
        if (info.results.length < selectedCount) {
            // "予約可能な席がございません"
            info.message = req.__('NoAvailableSeats');
            return info;
        }
        info.status = true;
        return info;
    });
}
/**
 * 購入者情報FIXプロセス
 *
 * @param {ReserveSessionModel} reservationModel
 * @returns {Promise<void>}
 */
function processFixProfile(reservationModel, req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        reserveProfileForm_1.default(req);
        const validationResult = yield req.getValidationResult();
        res.locals.validation = validationResult.mapped();
        res.locals.lastName = req.body.lastName;
        res.locals.firstName = req.body.firstName;
        res.locals.email = req.body.email;
        res.locals.emailConfirm = req.body.emailConfirm;
        res.locals.emailConfirmDomain = req.body.emailConfirmDomain;
        res.locals.tel = req.body.tel;
        res.locals.age = req.body.age;
        res.locals.address = req.body.address;
        res.locals.gender = req.body.gender;
        res.locals.paymentMethod = req.body.paymentMethod;
        if (!validationResult.isEmpty()) {
            const errors = req.validationErrors(true);
            if (errors !== undefined) {
                // tslint:disable-next-line:no-console
                console.log(errors);
            }
            throw new Error(req.__('Invalid"'));
        }
        // 購入者情報を保存して座席選択へ
        reservationModel.transactionInProgress.purchaser = {
            lastName: req.body.lastName,
            firstName: req.body.firstName,
            tel: req.body.tel,
            email: req.body.email,
            age: req.body.age,
            address: req.body.address,
            gender: req.body.gender
        };
        // 決済方法はクレジットカード一択
        reservationModel.transactionInProgress.paymentMethod = ttts.factory.paymentMethodType.CreditCard;
        yield ttts.service.transaction.placeOrderInProgress.setCustomerContact(reservationModel.transactionInProgress.agentId, reservationModel.transactionInProgress.id, {
            last_name: req.body.lastName,
            first_name: req.body.firstName,
            tel: req.body.tel,
            email: req.body.email,
            age: req.body.age,
            address: req.body.address,
            gender: req.body.gender
        })(new ttts.repository.Transaction(ttts.mongoose.connection));
        // セッションに購入者情報格納
        req.session.purchaser = {
            lastName: req.body.lastName,
            firstName: req.body.firstName,
            tel: req.body.tel,
            email: req.body.email,
            age: req.body.age,
            address: req.body.address,
            gender: req.body.gender
        };
    });
}
exports.processFixProfile = processFixProfile;
/**
 * 購入開始プロセス
 *
 * @param {string} purchaserGroup 購入者区分
 */
function processStart(purchaserGroup, req) {
    return __awaiter(this, void 0, void 0, function* () {
        // 言語も指定
        // 2017/06/19 upsate node+typesctipt
        req.session.locale = (!_.isEmpty(req.query.locale)) ? req.query.locale : 'ja';
        // 予約トークンを発行
        const reservationModel = new session_1.default({});
        reservationModel.transactionInProgress.purchaserGroup = purchaserGroup;
        reservationModel.transactionInProgress.category = req.query.category;
        initializePayment(reservationModel, req);
        if (!_.isEmpty(req.query.performance)) {
            // パフォーマンス指定遷移の場合 パフォーマンスFIX
            yield processFixPerformance(reservationModel, req.query.performance, req);
        }
        const organizationRepo = new ttts.repository.Organization(ttts.mongoose.connection);
        const seller = yield organizationRepo.findCorporationByIdentifier('TokyoTower');
        reservationModel.transactionInProgress.expires =
            moment().add(conf.get('temporary_reservation_valid_period_seconds'), 'seconds').toDate();
        const transaction = yield ttts.service.transaction.placeOrderInProgress.start({
            // tslint:disable-next-line:no-magic-numbers
            expires: reservationModel.transactionInProgress.expires,
            agentId: process.env.API_CLIENT_ID,
            sellerIdentifier: 'TokyoTower',
            purchaserGroup: purchaserGroup
        })(new ttts.repository.Transaction(ttts.mongoose.connection), new ttts.repository.Organization(ttts.mongoose.connection), new ttts.repository.Owner(ttts.mongoose.connection));
        debug('transaction started.', transaction.id);
        reservationModel.transactionInProgress.id = transaction.id;
        reservationModel.transactionInProgress.agentId = transaction.agent.id;
        reservationModel.transactionInProgress.sellerId = transaction.seller.id;
        reservationModel.transactionInProgress.seller = seller;
        return reservationModel;
    });
}
exports.processStart = processStart;
/**
 * 購入情報を初期化する
 */
function initializePayment(reservationModel, req) {
    if (reservationModel.transactionInProgress.purchaserGroup === undefined) {
        throw new Error('purchaser group undefined.');
    }
    const purchaserFromSession = req.session.purchaser;
    reservationModel.transactionInProgress.purchaser = {
        lastName: '',
        firstName: '',
        tel: '',
        email: '',
        age: '',
        address: '',
        gender: '1'
    };
    reservationModel.transactionInProgress.paymentMethodChoices = [ttts.GMO.utils.util.PayType.Credit, ttts.GMO.utils.util.PayType.Cvs];
    if (purchaserFromSession !== undefined) {
        reservationModel.transactionInProgress.purchaser = purchaserFromSession;
    }
}
/**
 * パフォーマンスをFIXするプロセス
 * パフォーマンスIDから、パフォーマンスを検索し、その後プロセスに必要な情報をreservationModelに追加する
 */
// tslint:disable-next-line:max-func-body-length
function processFixPerformance(reservationModel, perfomanceId, req) {
    return __awaiter(this, void 0, void 0, function* () {
        debug('fixing performance...', perfomanceId);
        // パフォーマンス取得
        const performanceRepo = new ttts.repository.Performance(ttts.mongoose.connection);
        const performance = yield performanceRepo.findById(perfomanceId);
        if (performance === null) {
            throw new Error(req.__('NotFound'));
        }
        if (performance.canceled === true) {
            throw new Error(req.__('Message.OutOfTerm'));
        }
        // 上映日当日まで購入可能
        // tslint:disable-next-line:no-magic-numbers
        if (parseInt(performance.day, 10) < parseInt(moment().format('YYYYMMDD'), 10)) {
            throw new Error('You cannot reserve this performance.');
        }
        // 券種セット
        reservationModel.transactionInProgress.ticketTypes = performance.ticket_type_group.ticket_types.map((t) => {
            return Object.assign({}, t, { count: 0 });
        });
        reservationModel.transactionInProgress.reservations = [];
        // パフォーマンス情報を保管
        reservationModel.transactionInProgress.performance = Object.assign({}, performance, {
            film: Object.assign({}, performance.film, {
                image: `${req.protocol}://${req.hostname}/images/film/${performance.film.id}.jpg`
            })
        });
        // 座席グレードリスト抽出
        reservationModel.transactionInProgress.seatGradeCodesInScreen =
            reservationModel.transactionInProgress.performance.screen.sections[0].seats
                .map((seat) => seat.grade.code)
                .filter((seatCode, index, seatCodes) => seatCodes.indexOf(seatCode) === index);
        // スクリーン座席表HTMLを保管(TTTS未使用)
        reservationModel.transactionInProgress.screenHtml = '';
    });
}
exports.processFixPerformance = processFixPerformance;
/**
 * 予約完了メールを作成する
 * @memberof controller/reserveBase
 */
function createEmailQueue(reservations, reservationModel, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const reservationRepo = new ttts.repository.Reservation(ttts.mongoose.connection);
        // 特殊チケットは除外
        reservations = reservations.filter((reservation) => reservation.status === ttts.factory.reservationStatusType.ReservationConfirmed);
        // チケットコード順にソート
        reservations.sort((a, b) => {
            if (a.ticket_type < b.ticket_type) {
                return -1;
            }
            if (a.ticket_type > b.ticket_type) {
                return 1;
            }
            return 0;
        });
        const reservationDocs = reservations.map((reservation) => new reservationRepo.reservationModel(reservation));
        const to = reservations[0].purchaser_email;
        debug('to is', to);
        if (to.length === 0) {
            throw new Error('email to unknown');
        }
        const title = res.__('Title');
        const titleEmail = res.__('EmailTitle');
        // 券種ごとに合計枚数算出
        const ticketInfos = {};
        for (const reservation of reservations) {
            // チケットタイプセット
            const dataValue = reservation.ticket_type;
            // チケットタイプごとにチケット情報セット
            if (!ticketInfos.hasOwnProperty(dataValue)) {
                ticketInfos[dataValue] = {
                    ticket_type_name: reservation.ticket_type_name,
                    charge: `\\${numeral(reservation.charge).format('0,0')}`,
                    count: 1
                };
            }
            else {
                ticketInfos[dataValue].count += 1;
            }
        }
        // 券種ごとの表示情報編集 (sort順を変えないよう同期Loop:"for of")
        const ticketInfoArray = [];
        for (const key of Object.keys(ticketInfos)) {
            const ticketInfo = ticketInfos[key];
            ticketInfoArray.push(`${ticketInfo.ticket_type_name[res.locale]} ${res.__('{{n}}Leaf', { n: ticketInfo.count })}`);
        }
        const day = moment(reservations[0].performance_day, 'YYYYMMDD').format('YYYY/MM/DD');
        // tslint:disable-next-line:no-magic-numbers
        const time = `${reservations[0].performance_start_time.substr(0, 2)}:${reservations[0].performance_start_time.substr(2, 2)}`;
        return new Promise((resolve, reject) => {
            res.render('email/reserve/complete', {
                layout: false,
                reservations: reservationDocs,
                moment: moment,
                numeral: numeral,
                conf: conf,
                GMOUtil: ttts.GMO.utils.util,
                ticketInfoArray: ticketInfoArray,
                totalCharge: reservationModel.getTotalCharge(),
                dayTime: `${day} ${time}`
            }, (renderErr, text) => __awaiter(this, void 0, void 0, function* () {
                debug('email template rendered.', renderErr);
                if (renderErr instanceof Error) {
                    reject(new Error('failed in rendering an email.'));
                    return;
                }
                const emailQueue = {
                    from: {
                        address: conf.get('email.from'),
                        name: conf.get('email.fromname')
                    },
                    to: {
                        address: to
                        // name: 'testto'
                    },
                    subject: `${title} ${titleEmail}`,
                    content: {
                        mimetype: 'text/plain',
                        text: text
                    },
                    status: ttts.EmailQueueUtil.STATUS_UNSENT
                };
                resolve(emailQueue);
            }));
        });
    });
}
exports.createEmailQueue = createEmailQueue;
