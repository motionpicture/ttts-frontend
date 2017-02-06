import {ReservationUtil} from "@motionpicture/ttts-domain";
import GMOUtil from '../../../common/Util/GMO/GMOUtil';
import conf = require('config');
import moment = require('moment');
import redis = require('redis');

const redisClient = redis.createClient(
    conf.get<number>("redis_port"),
    conf.get<string>("redis_host"),
    {
        password: conf.get<string>("redis_key"),
        tls: { servername: conf.get<string>("redis_host") },
        return_buffers: true
    }
);

/**
 * 予約情報モデル
 * 
 * 予約プロセス中の情報を全て管理するためのモデルです
 * この情報をセッションで引き継くことで、予約プロセスを管理しています
 */
export default class ReservationModel {
    /** 予約トークン */
    public token: string;
    /** 購入管理番号 */
    public paymentNo: string;
    /** 購入確定日時タイムスタンプ */
    public purchasedAt: number;
    /** 座席仮予約有効期限タイムスタンプ */
    public expiredAt: number;
    /** パフォーマンス */
    public performance: Performance;
    /** 決済方法選択肢 */
    public paymentMethodChoices: Array<string>;
    /** 券種リスト */
    public ticketTypes: Array<TicketType>;
    /** スクリーン内の座席グレードリスト */
    public seatGradeCodesInScreen: Array<string>;
    /** スクリーンの座席表HTML */
    public screenHtml: string;
    /** 予約座席コードリスト */
    public seatCodes: Array<string>;
    /** 購入者セイ */
    public purchaserLastName: string;
    /** 購入者メイ */
    public purchaserFirstName: string;
    /** 購入者メールアドレス */
    public purchaserEmail: string;
    /** 購入者電話番号 */
    public purchaserTel: string;
    /** 年代 */
    public purchaserAge: string;
    /** 住所 */
    public purchaserAddress: string;
    /** 性別 */
    public purchaserGender: string;
    /** 決済方法 */
    public paymentMethod: string;
    /** 購入者区分 */
    public purchaserGroup: string;

    /**
     * プロセス中の購入情報をセッションに保存する
     * 
     * @param {number} ttl 有効期間(default: 1800)
     */
    public save(cb: () => void, ttl?: number) {
        let key = ReservationModel.getRedisKey(this.token);
        let _ttl = (ttl) ? ttl : 1800;
        redisClient.setex(key, _ttl, JSON.stringify(this), (err) => {
            if (err) throw err;
            cb();
        });
    }

    /**
     * プロセス中の購入情報をセッションから削除する
     */
    public remove(cb: (err: Error | void) => void) {
        let key = ReservationModel.getRedisKey(this.token);
        redisClient.del(key, (err) => {
            cb(err);
        });
    }

    /**
     * プロセス中の購入情報をセッションから取得する
     */
    public static find(token: string, cb: (err: Error | void, reservationModel: ReservationModel) => void): void {
        let key = ReservationModel.getRedisKey(token);
        redisClient.get(key, (err, reply) => {
            if (err) return cb(err, null);
            if (reply === null) return cb(new Error('Not Found'), null);

            let reservationModel = new ReservationModel();

            try {
                let reservationModelInRedis = JSON.parse(reply.toString());
                for (let propertyName in reservationModelInRedis) {
                    reservationModel[propertyName] = reservationModelInRedis[propertyName];
                }
            } catch (error) {
                return cb(err, null);
            }

            cb(null, reservationModel);
        });
    }

    /**
     * ネームスペースを取得
     *
     * @param {string} token
     * @return {string}
     */
    private static getRedisKey(token): string {
        return `TTTSReservation_${token}`;
    }

    /**
     * 一度の購入で予約できる座席数を取得する
     */
    public getSeatsLimit(): number {
        let limit = 4;

        // 主体によっては、決済方法を強制的に固定で
        switch (this.purchaserGroup) {
            case ReservationUtil.PURCHASER_GROUP_SPONSOR:
            case ReservationUtil.PURCHASER_GROUP_STAFF:
            case ReservationUtil.PURCHASER_GROUP_WINDOW:
                limit = 10;
                break;

            case ReservationUtil.PURCHASER_GROUP_CUSTOMER:
            case ReservationUtil.PURCHASER_GROUP_TEL:
                if (this.performance) {
                    // 制限枚数指定のパフォーマンスの場合
                    let performanceIds4limit2 = conf.get<Array<string>>('performanceIds4limit2');
                    if (performanceIds4limit2.indexOf(this.performance._id) >= 0) {
                        limit = 2;
                    }
                }

                break;

            default:
                break;
        }

        return limit;
    }

    /**
     * 合計金額を算出する
     */
    public getTotalCharge(): number {
        let total = 0;

        if (Array.isArray(this.seatCodes)) {
            this.seatCodes.forEach((seatCode) => {
                total += this.getChargeBySeatCode(seatCode);
            });
        }

        return total;
    }

    /**
     * 座席単体の料金を算出する
     */
    public getChargeBySeatCode(seatCode: string): number {
        let charge = 0;

        let reservation = this.getReservation(seatCode);
        if (reservation.ticket_type_charge) {
            charge += reservation.ticket_type_charge;
            charge += this.getChargeExceptTicketTypeBySeatCode(seatCode);
        }

        return charge;
    }

    public getChargeExceptTicketTypeBySeatCode(seatCode: string): number {
        let charge = 0;

        if (this.purchaserGroup === ReservationUtil.PURCHASER_GROUP_CUSTOMER
         || this.purchaserGroup === ReservationUtil.PURCHASER_GROUP_WINDOW
         || this.purchaserGroup === ReservationUtil.PURCHASER_GROUP_TEL
        ) {
            let reservation = this.getReservation(seatCode);

            // 座席グレード分加算
            if (reservation.seat_grade_additional_charge > 0) {
                charge += reservation.seat_grade_additional_charge;
            }

            // MX4D分加算
            if (this.performance.film.is_mx4d) {
                charge += ReservationUtil.CHARGE_MX4D;
            }

            // コンビニ手数料加算
            if (this.paymentMethod === GMOUtil.PAY_TYPE_CVS) {
                charge += ReservationUtil.CHARGE_CVS;
            }
        }

        return charge;
    }

    /**
     * 座席コードから予約情報を取得する
     */
    public getReservation(seatCode: string): Reservation {
        return (this[`reservation_${seatCode}`]) ? this[`reservation_${seatCode}`] : null;
    }

    /**
     * 座席コードの予約情報をセットする
     */
    public setReservation(seatCode: string, reservation: Reservation): void {
        this[`reservation_${seatCode}`] = reservation;
    }

    /**
     * フロー中の予約IDリストを取得する
     */
    public getReservationIds(): Array<string> {
        return (this.seatCodes) ? this.seatCodes.map((seatCode) => {return this.getReservation(seatCode)._id;}) : [];
    }

    /**
     * 座席コードから予約(確定)ドキュメントを作成する
     * 
     * @param {string} seatCode 座席コード
     */
    public seatCode2reservationDocument(seatCode: string) {
        let reservation = this.getReservation(seatCode);
        let doc =  {
            _id: reservation._id,
            status: reservation.status,
            seat_code: seatCode,
            seat_grade_name_ja: reservation.seat_grade_name_ja,
            seat_grade_name_en: reservation.seat_grade_name_en,
            seat_grade_additional_charge: reservation.seat_grade_additional_charge,
            ticket_type_code: reservation.ticket_type_code,
            ticket_type_name_ja: reservation.ticket_type_name_ja,
            ticket_type_name_en: reservation.ticket_type_name_en,
            ticket_type_charge: reservation.ticket_type_charge,

            charge: this.getChargeBySeatCode(seatCode),
            payment_no: this.paymentNo,
            purchaser_group: this.purchaserGroup,

            performance: this.performance._id,
            performance_day: this.performance.day,
            performance_open_time: this.performance.open_time,
            performance_start_time: this.performance.start_time,
            performance_end_time: this.performance.end_time,

            theater: this.performance.theater._id,
            theater_name_ja: this.performance.theater.name.ja,
            theater_name_en: this.performance.theater.name.en,
            theater_address_ja: this.performance.theater.address.ja,
            theater_address_en: this.performance.theater.address.en,

            screen: this.performance.screen._id,
            screen_name_ja: this.performance.screen.name.ja,
            screen_name_en: this.performance.screen.name.en,

            film: this.performance.film._id,
            film_name_ja: this.performance.film.name.ja,
            film_name_en: this.performance.film.name.en,
            film_image: this.performance.film.image,
            film_is_mx4d: this.performance.film.is_mx4d,
            film_copyright: this.performance.film.copyright,

            purchaser_last_name: (this.purchaserLastName) ? this.purchaserLastName : '',
            purchaser_first_name: (this.purchaserFirstName) ? this.purchaserFirstName : '',
            purchaser_email: (this.purchaserEmail) ? this.purchaserEmail : '',
            purchaser_tel: (this.purchaserTel) ? this.purchaserTel : '',
            purchaser_age: (this.purchaserAge) ? this.purchaserAge : '',
            purchaser_address: (this.purchaserAddress) ? this.purchaserAddress : '',
            purchaser_gender: (this.purchaserGender) ? this.purchaserGender : '',
            payment_method: (this.paymentMethod) ? this.paymentMethod : '',

            watcher_name: (reservation.watcher_name) ? reservation.watcher_name : '',
            watcher_name_updated_at: (reservation.watcher_name) ? moment().valueOf() : '',

            purchased_at: this.purchasedAt,

            gmo_shop_pass_string: (this.getTotalCharge() > 0) ? GMOUtil.createShopPassString(
                conf.get<string>('gmo_payment_shop_id'),
                this.paymentNo,
                this.getTotalCharge().toString(),
                conf.get<string>('gmo_payment_shop_password'),
                moment(this.purchasedAt).format('YYYYMMDDHHmmss')
            ) : '',

            updated_user: 'ReservationModel'
        };

        return doc;
    }
}

interface Performance {
    _id: string,
    day: string,
    open_time: string,
    start_time: string,
    end_time: string,
    start_str_ja: string,
    start_str_en: string,
    location_str_ja: string,
    location_str_en: string,
    theater: {
        _id: string,
        name: {
            ja: string,
            en: string
        },
        address: {
            ja: string,
            en: string
        }
    },
    screen: {
        _id: string,
        name: {
            ja: string,
            en: string
        },
        sections: Array<{
            seats: Array<{
                code: string, // 座席コード
                grade: {
                    code: string,
                    name: {
                        ja: string,
                        en: string
                    },
                    additional_charge: number // 追加料金
                }
            }>
        }>
    },
    film: {
        _id: string,
        name: {
            ja: string,
            en: string
        },
        image: string,
        is_mx4d: boolean,
        copyright: string
    },
}

interface TicketType {
    code: string,
    name: {
        ja: string,
        en: string
    },
    charge: number // 料金
}

interface Reservation {
    _id: string;
    status: string;
    seat_code: string,
    seat_grade_name_ja: string,
    seat_grade_name_en: string,
    seat_grade_additional_charge: number,

    ticket_type_code: string,
    ticket_type_name_ja: string,
    ticket_type_name_en: string,
    ticket_type_charge: number,

    watcher_name: string
}