
/**
 * 座席予約ベースコントローラー
 * @namespace controller.reserveBase
 */

import * as tttsapi from '@motionpicture/ttts-api-nodejs-client';
import * as conf from 'config';
import * as createDebug from 'debug';
import { Request, Response } from 'express';
import * as moment from 'moment';
import * as numeral from 'numeral';
import * as _ from 'underscore';

import reserveProfileForm from '../forms/reserve/reserveProfileForm';
import reserveTicketForm from '../forms/reserve/reserveTicketForm';
import ReserveSessionModel from '../models/reserve/session';

const debug = createDebug('ttts-frontend:controller:reserveBase');

const authClient = new tttsapi.auth.ClientCredentials({
    domain: <string>process.env.API_AUTHORIZE_SERVER_DOMAIN,
    clientId: <string>process.env.API_CLIENT_ID,
    clientSecret: <string>process.env.API_CLIENT_SECRET,
    scopes: [
        `${<string>process.env.API_RESOURECE_SERVER_IDENTIFIER}/organizations.read-only`,
        `${<string>process.env.API_RESOURECE_SERVER_IDENTIFIER}/performances.read-only`,
        `${<string>process.env.API_RESOURECE_SERVER_IDENTIFIER}/transactions`
    ],
    state: ''
});

const placeOrderTransactionService = new tttsapi.service.transaction.PlaceOrder({
    endpoint: <string>process.env.API_ENDPOINT,
    auth: authClient
});

const organizationService = new tttsapi.service.Organization({
    endpoint: <string>process.env.API_ENDPOINT,
    auth: authClient
});

/**
 * 購入開始プロセス
 * @param {string} purchaserGroup 購入者区分
 */
export async function processStart(purchaserGroup: string, req: Request): Promise<ReserveSessionModel> {
    // 言語も指定
    (<Express.Session>req.session).locale = (!_.isEmpty(req.query.locale)) ? req.query.locale : 'ja';

    const sellerIdentifier = 'TokyoTower';
    const seller = await organizationService.findCorporationByIdentifier({ identifier: sellerIdentifier });

    const expires = moment().add(conf.get<number>('temporary_reservation_valid_period_seconds'), 'seconds').toDate();
    const transaction = await placeOrderTransactionService.start({
        expires: expires,
        sellerIdentifier: sellerIdentifier, // 電波塔さんの組織識別子(現時点で固定)
        purchaserGroup: <any>purchaserGroup,
        passportToken: req.query.passportToken
    });
    debug('transaction started.', transaction.id);

    // 取引セッションを初期化
    const transactionInProgress: Express.ITransactionInProgress = {
        id: transaction.id,
        agentId: transaction.agent.id,
        seller: seller,
        sellerId: transaction.seller.id,
        category: (req.query.wc === '1') ? 'wheelchair' : 'general',
        expires: expires.toISOString(),
        paymentMethodChoices: [tttsapi.factory.paymentMethodType.CreditCard],
        ticketTypes: [],
        // seatGradeCodesInScreen: [],
        purchaser: {
            lastName: '',
            firstName: '',
            tel: '',
            email: '',
            age: '',
            address: '',
            gender: '0'
        },
        paymentMethod: tttsapi.factory.paymentMethodType.CreditCard,
        purchaserGroup: purchaserGroup,
        transactionGMO: {
            orderId: '',
            amount: 0,
            count: 0
        },
        reservations: []
    };

    const reservationModel = new ReserveSessionModel(transactionInProgress);

    // セッションに購入者情報があれば初期値セット
    const purchaserFromSession = (<Express.Session>req.session).purchaser;
    if (purchaserFromSession !== undefined) {
        reservationModel.transactionInProgress.purchaser = purchaserFromSession;
    }

    return reservationModel;
}

/**
 * 座席・券種確定プロセス
 */
export async function processFixSeatsAndTickets(reservationModel: ReserveSessionModel, req: Request): Promise<void> {
    // パフォーマンスは指定済みのはず
    if (reservationModel.transactionInProgress.performance === undefined) {
        throw new Error(req.__('UnexpectedError'));
    }

    // 検証(券種が選択されていること)+チケット枚数合計計算
    const checkInfo = await checkFixSeatsAndTickets(reservationModel.transactionInProgress.ticketTypes, req);
    if (!checkInfo.status) {
        throw new Error(checkInfo.message);
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
        return {
            ticket_type: choice.ticket_type,
            watcher_name: ''
        };
    });
    debug(`creating seatReservation authorizeAction on ${offers.length} offers...`);
    const action = await placeOrderTransactionService.createSeatReservationAuthorization({
        transactionId: reservationModel.transactionInProgress.id,
        performanceId: reservationModel.transactionInProgress.performance.id,
        offers: offers
    });
    reservationModel.transactionInProgress.seatReservationAuthorizeActionId = action.id;
    // この時点で購入番号が発行される
    reservationModel.transactionInProgress.paymentNo =
        (<tttsapi.factory.action.authorize.seatReservation.IResult>action.result).tmpReservations[0].payment_no;
    const tmpReservations = (<tttsapi.factory.action.authorize.seatReservation.IResult>action.result).tmpReservations;

    // セッションに保管
    reservationModel.transactionInProgress.reservations = tmpReservations.filter(
        (r) => r.status_after === tttsapi.factory.reservationStatusType.ReservationConfirmed
    );
}

export interface ICheckInfo {
    status: boolean;
    choices: IChoice[];
    choicesAll: IChoiceInfo[];
    selectedCount: number;
    extraCount: number;
    message: string;
}

export interface IChoice {
    ticket_count: string;
    ticket_type: string;
}

export interface IChoiceInfo {
    ticket_type: string;
    ticketCount: number;
    choicesExtra: {
        ticket_type: string;
        ticketCount: number;
        updated: boolean;
    }[];
    updated: boolean;
}

/**
 * 座席・券種確定プロセス/検証処理
 */
async function checkFixSeatsAndTickets(ticketTypes: Express.ITicketType[], req: Request): Promise<ICheckInfo> {
    const checkInfo: ICheckInfo = {
        status: false,
        choices: [],
        choicesAll: [],
        selectedCount: 0,
        extraCount: 0,
        message: ''
    };
    // 検証(券種が選択されていること)
    reserveTicketForm(req);
    const validationResult = await req.getValidationResult();
    if (!validationResult.isEmpty()) {
        checkInfo.message = req.__('Invalid');

        return checkInfo;
    }
    // 画面から座席選択情報が生成できなければエラー
    const choices: IChoice[] = JSON.parse(req.body.choices);
    if (!Array.isArray(choices)) {
        checkInfo.message = req.__('UnexpectedError');

        return checkInfo;
    }
    checkInfo.choices = choices;

    // 特殊チケット情報
    const extraSeatNum: {
        [key: string]: number;
    } = {};
    ticketTypes.forEach((ticketTypeInArray) => {
        if (ticketTypeInArray.ttts_extension.category !== tttsapi.factory.ticketTypeCategory.Normal) {
            extraSeatNum[ticketTypeInArray.id] = ticketTypeInArray.ttts_extension.required_seat_num;
        }
    });

    // チケット枚数合計計算
    choices.forEach((choice) => {
        // チケットセット(選択枚数分)
        checkInfo.selectedCount += Number(choice.ticket_count);
        for (let index = 0; index < Number(choice.ticket_count); index += 1) {
            const choiceInfo: IChoiceInfo = {
                ticket_type: choice.ticket_type,
                ticketCount: 1,
                choicesExtra: [],
                updated: false
            };
            // 特殊の時、必要枚数分セット
            if (extraSeatNum.hasOwnProperty(choice.ticket_type)) {
                const extraCount: number = Number(extraSeatNum[choice.ticket_type]) - 1;
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
}

export async function isValidProfile(req: Request, res: Response): Promise<boolean> {
    reserveProfileForm(req);

    const validationResult = await req.getValidationResult();
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

    return validationResult.isEmpty();
}

/**
 * 購入者情報確定プロセス
 * @param {ReserveSessionModel} reservationModel
 * @returns {Promise<void>}
 */
export async function processFixProfile(reservationModel: ReserveSessionModel, req: Request): Promise<void> {

    // 購入者情報を保存して座席選択へ
    const contact: Express.IPurchaser = {
        lastName: (req.body.lastName !== undefined) ? req.body.lastName : '',
        firstName: (req.body.firstName !== undefined) ? req.body.firstName : '',
        tel: (req.body.tel !== undefined) ? req.body.tel : '',
        email: (req.body.email !== undefined) ? req.body.email : '',
        age: (req.body.age !== undefined) ? req.body.age : '',
        address: (req.body.address !== undefined) ? req.body.address : '',
        gender: (req.body.gender !== undefined) ? req.body.gender : ''
    };
    reservationModel.transactionInProgress.purchaser = contact;

    // 決済方法はクレジットカード一択
    reservationModel.transactionInProgress.paymentMethod = tttsapi.factory.paymentMethodType.CreditCard;

    const customerContact = await placeOrderTransactionService.setCustomerContact({
        transactionId: reservationModel.transactionInProgress.id,
        contact: {
            last_name: contact.lastName,
            first_name: contact.firstName,
            email: contact.email,
            tel: contact.tel,
            age: contact.age,
            address: contact.address,
            gender: contact.gender
        }
    });
    debug('customerContact set.', customerContact);

    // セッションに購入者情報格納
    (<Express.Session>req.session).purchaser = contact;
}

/**
 * パフォーマンスをFIXするプロセス
 * パフォーマンスIDから、パフォーマンスを検索し、その後プロセスに必要な情報をreservationModelに追加する
 */
export async function processFixPerformance(
    reservationModel: ReserveSessionModel, perfomanceId: string, req: Request
): Promise<void> {
    debug('fixing performance...', perfomanceId);
    // パフォーマンス取得

    const eventService = new tttsapi.service.Event({
        endpoint: <string>process.env.API_ENDPOINT,
        auth: authClient
    });
    const performance = await eventService.findPerofrmanceById({ id: perfomanceId });
    if (performance === null) {
        throw new Error(req.__('NotFound'));
    }

    // 上映日当日まで購入可能
    // tslint:disable-next-line:no-magic-numbers
    if (parseInt(moment(performance.start_date).format('YYYYMMDD'), 10) < parseInt(moment().format('YYYYMMDD'), 10)) {
        throw new Error(req.__('Message.OutOfTerm'));
    }

    // 券種セット
    reservationModel.transactionInProgress.ticketTypes = performance.ticket_type_group.ticket_types.map((t) => {
        return { ...t, ...{ count: 0 } };
    });

    // パフォーマンス情報を保管
    reservationModel.transactionInProgress.performance = performance;

    // 座席グレードリスト抽出
    // reservationModel.transactionInProgress.seatGradeCodesInScreen = performance.screen.sections[0].seats
    //     .map((seat) => seat.grade.code)
    //     .filter((seatCode, index, seatCodes) => seatCodes.indexOf(seatCode) === index);
}

/**
 * 予約完了メールを作成する
 * @memberof controller.reserveBase
 */
export async function createEmailAttributes(
    reservationParams: tttsapi.factory.reservation.event.IReservation[],
    totalCharge: number,
    res: Response
): Promise<tttsapi.factory.creativeWork.message.email.IAttributes> {
    // 特殊チケットは除外
    const reservations = reservationParams.filter((r) => r.status === tttsapi.factory.reservationStatusType.ReservationConfirmed);
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

    const to = reservations[0].purchaser_email;
    debug('to is', to);
    if (to.length === 0) {
        throw new Error('email to unknown');
    }

    const title = res.__('Title');
    const titleEmail = res.__('EmailTitle');

    // メール本文取得
    const text: string = getMailText(res, totalCharge, reservations);

    // メール情報セット
    return new Promise<tttsapi.factory.creativeWork.message.email.IAttributes>((resolve) => {
        resolve({
            sender: {
                name: conf.get<string>('email.fromname'),
                email: conf.get<string>('email.from')
            },
            toRecipient: {
                name: reservations[0].purchaser_name,
                email: to
            },
            about: `${title} ${titleEmail}`,
            text: text
        });
    });
}
/**
 * メール本文取得
 * @function getMailText
 * @param {Response} res
 * @param {number} totalCharge
 * @param {tttsapi.factory.reservation.event.IReservation[]}reservations
 * @returns {string}
 */
function getMailText(
    res: Response,
    totalCharge: number,
    reservations: tttsapi.factory.reservation.event.IReservation[]
): string {
    const mail: string[] = [];
    const locale: string = res.locale;

    // 東京タワートップデッキツアーチケット購入完了のお知らせ
    mail.push(res.__('EmailTitle'));
    mail.push('');

    // 姓名編集: 日本語の時は"姓名"他は"名姓"
    const purchaserName = (locale === 'ja') ?
        `${reservations[0].purchaser_last_name} ${reservations[0].purchaser_first_name}` :
        `${reservations[0].purchaser_first_name} ${reservations[0].purchaser_last_name}`;
    // XXXX XXXX 様
    mail.push(res.__('EmailDestinationName{{name}}', { name: purchaserName }));
    mail.push('');

    // この度は、「東京タワー トップデッキツアー」のWEBチケット予約販売をご利用頂き、誠にありがとうございます。
    mail.push(res.__('EmailHead1').replace(
        '$theater_name$', (<any>reservations[0]).theater_name[locale]
    ));
    // お客様がご購入されましたチケットの情報は下記の通りです。
    mail.push(res.__('EmailHead2'));
    mail.push('');

    // 購入番号
    mail.push(`${res.__('PaymentNo')} : ${reservations[0].payment_no}`);

    // ご来塔日時
    const day: string = moment(reservations[0].performance_day, 'YYYYMMDD').format('YYYY/MM/DD');
    // tslint:disable-next-line:no-magic-numbers
    const time: string = `${reservations[0].performance_start_time.substr(0, 2)}:${reservations[0].performance_start_time.substr(2, 2)}`;
    mail.push(`${res.__('EmailReserveDate')} : ${day} ${time}`);

    // 券種、枚数
    mail.push(`${res.__('TicketType')} ${res.__('TicketCount')}`);

    // 券種ごとに合計枚数算出
    const ticketInfos = editTicketInfos(res, getTicketInfos(reservations));
    Object.keys(ticketInfos).forEach((key: string) => {
        mail.push(ticketInfos[key].info);
    });
    mail.push('-------------------------------------');
    // 合計枚数
    mail.push(res.__('EmailTotalTicketCount{{n}}', { n: reservations.length.toString() }));
    // 合計金額
    mail.push(`${res.__('TotalPrice')} ${res.__('{{price}} yen', { price: numeral(totalCharge).format('0,0') })}`);
    mail.push('-------------------------------------');
    // ※ご入場の際はQRコードが入場チケットとなります。下記のチケット照会より、QRコードを画面撮影もしくは印刷の上、ご持参ください。
    mail.push(res.__('EmailAboutQR'));
    mail.push('');

    // ●チケット照会はこちら
    mail.push(res.__('EmailInquiryUrl'));
    mail.push((conf.get<any>('official_url_inquiry_by_locale'))[locale]);
    mail.push('');

    // ●ご入場方法はこちら
    mail.push(res.__('EmailEnterURL'));
    mail.push((conf.get<any>('official_url_aboutentering_by_locale'))[locale]);
    mail.push('');

    // [ご注意事項]
    mail.push(res.__('EmailNotice1'));
    mail.push(res.__('EmailNotice9'));
    mail.push(res.__('EmailNotice2'));
    mail.push(res.__('EmailNotice3'));
    mail.push(res.__('EmailNotice4'));
    mail.push(res.__('EmailNotice5'));
    mail.push(res.__('EmailNotice6'));
    mail.push(res.__('EmailNotice7'));
    mail.push(res.__('EmailNotice8'));
    mail.push('');

    // ※よくあるご質問（ＦＡＱ）はこちら
    mail.push(res.__('EmailFAQURL'));
    mail.push((conf.get<any>('official_url_faq_by_locale'))[locale]);
    mail.push('');

    // なお、このメールは、「東京タワー トップデッキツアー」の予約システムでチケットをご購入頂いた方にお送りしておりますが、チケット購入に覚えのない方に届いております場合は、下記お問い合わせ先までご連絡ください。
    mail.push(res.__('EmailFoot1').replace('$theater_name$', (<any>reservations[0]).theater_name[locale]));
    // ※尚、このメールアドレスは送信専用となっておりますでので、ご返信頂けません。
    mail.push(res.__('EmailFoot2'));
    // ご不明な点がございましたら、下記番号までお問合わせください。
    mail.push(res.__('EmailFoot3'));
    mail.push('');

    // お問い合わせはこちら
    mail.push(res.__('EmailAccess1'));
    // 東京タワー TEL : 03-3433-5111 / 9：00am～17：00pm（年中無休）
    mail.push(res.__('EmailAccess2'));

    return (mail.join('\n'));
}
/**
 * 券種ごとに合計枚数算出
 * @param {any} reservations
 * @returns {any>}
 */
function getTicketInfos(reservations: any[]): any {
    // 券種ごとに合計枚数算出
    const keyName: string = 'ticket_type';
    const ticketInfos: {} = {};
    for (const reservation of reservations) {
        // チケットタイプセット
        const dataValue = reservation[keyName];
        // チケットタイプごとにチケット情報セット
        if (!ticketInfos.hasOwnProperty(dataValue)) {
            (<any>ticketInfos)[dataValue] = {
                ticket_type_name: reservation.ticket_type_name,
                charge: `\\${numeral(reservation.charge).format('0,0')}`,
                count: 1
            };
        } else {
            (<any>ticketInfos)[dataValue].count += 1;
        }
    }

    return ticketInfos;
}
/**
 * 券種ごとの表示情報編集
 * @param {Response} res
 * @param {any} ticketInfos
 * @returns {any>}
 */
function editTicketInfos(res: Response, ticketInfos: any[]): any {
    const locale = res.locale;
    // 券種ごとの表示情報編集
    Object.keys(ticketInfos).forEach((key) => {
        const ticketInfo = (<any>ticketInfos)[key];
        const ticketCountEdit = res.__('{{n}}Leaf', { n: ticketInfo.count.toString() });
        (<any>ticketInfos)[key].info = `${ticketInfo.ticket_type_name[locale]} ${ticketInfo.charge} × ${ticketCountEdit}`;
    });

    return ticketInfos;
}
