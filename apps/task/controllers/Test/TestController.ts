import BaseController from '../BaseController';
import Constants from '../../../common/Util/Constants';
import Util from '../../../common/Util/Util';
import Models from '../../../common/models/Models';
import ReservationUtil from '../../../common/models/Reservation/ReservationUtil';
import PerformanceUtil from '../../../common/models/Performance/PerformanceUtil';
import FilmUtil from '../../../common/models/Film/FilmUtil';
import TicketTypeGroupUtil from '../../../common/models/TicketTypeGroup/TicketTypeGroupUtil';
import ScreenUtil from '../../../common/models/Screen/ScreenUtil';
import moment = require('moment');
import conf = require('config');
import mongodb = require('mongodb');
import mongoose = require('mongoose');
import PerformanceStatusesModel from '../../../common/models/PerformanceStatusesModel';
import request = require('request');
import sendgrid = require('sendgrid')
import emailTemplates = require('email-templates');

let MONGOLAB_URI = conf.get<string>('mongolab_uri');

export default class TestController extends BaseController {
    /**
     * 仮予約ステータスで、一定時間過ぎた予約を空席にする
     */
    public removeTemporaryReservations(): void {
        mongoose.connect(MONGOLAB_URI, {});

        this.logger.info('updating temporary reservations...');
        Models.Reservation.remove(
            {
                status: ReservationUtil.STATUS_TEMPORARY,
                updated_at: {
                    $lt: moment().add(-10, 'minutes').toISOString()
                },
            },
            (err) => {
                mongoose.disconnect();

                // 失敗しても、次のタスクにまかせる(気にしない)
                if (err) {
                } else {
                }

                process.exit(0);
            }
        );
    }

    /**
     * 券種グループを初期化する
     */
    public createTicketTypeGroups(): void {
        mongoose.connect(MONGOLAB_URI, {});

        this.logger.debug('removing all ticketTypeGroups...');
        Models.TicketTypeGroup.remove({}, (err) => {
            this.logger.debug('creating films...');
            Models.TicketTypeGroup.create(
                TicketTypeGroupUtil.getAll(),
                (err, documents) => {
                    this.logger.debug('ticketTypeGroups created.');

                    mongoose.disconnect();

                    if (err) {
                    } else {
                        this.logger.debug('success!');
                        process.exit(0);
                    }
                }
            );
        });
    }

    /**
     * 作品を初期化する
     */
    public createFilms(): void {
        mongoose.connect(MONGOLAB_URI, {});

        Models.TicketTypeGroup.find({}, '_id', (err, ticketTypeGroupDocuments) => {
            if (err) {
                mongoose.disconnect();
                this.logger.info('err:', err);
                process.exit(0);
            }

            let genres = FilmUtil.getGenres();
            let sections = FilmUtil.getSections();
            let testNames = FilmUtil.getTestNames();
            let length = testNames.length;
            let films = [];

            this.logger.info('ticketTypeGroupDocuments.length:', ticketTypeGroupDocuments.length);
            for (let i = 0; i < length; i++) {
                let no = i + 1;
                let _sections = this.shuffle(sections);
                let _genres = this.shuffle(genres);
                let _ticketTypeGroupDocuments = this.shuffle(ticketTypeGroupDocuments);
                let min = 60 + Math.floor(Math.random() * 120);

                films.push({
                    name: testNames[i].name,
                    name_en: testNames[i].name_en,
                    sections: _sections.slice(0, Math.floor(Math.random() * 5)),
                    genres: _genres.slice(0, Math.floor(Math.random() * 5)),
                    ticket_type_group: _ticketTypeGroupDocuments[0].get('_id'),
                    created_user: 'system',
                    updated_user: 'system',
                });
            }

            this.logger.debug('removing all films...');
            Models.Film.remove({}, (err) => {
                this.logger.debug('creating films...');
                Models.Film.create(
                    films,
                    (err, filmDocuments) => {
                        this.logger.debug('films created.');

                        mongoose.disconnect();

                        if (err) {
                        } else {
                            this.logger.debug('success!');
                            process.exit(0);
                        }
                    }
                );
            });

        });

    }

    private shuffle(array) {
        let m = array.length, t, i;

        // While there remain elements to shuffle…
        while (m) {

            // Pick a remaining element…
            i = Math.floor(Math.random() * m--);

            // And swap it with the current element.
            t = array[m];
            array[m] = array[i];
            array[i] = t;
        }

        return array;
    }

    private getSeats() {
        let seats = [];
        let letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
        let grades = ScreenUtil.getSeatGrades();

        for (let i = 0; i < 30; i++) {
            let no = i + 1;

            letters.forEach((letter) => {
                let _grades = this.shuffle(grades);

                seats.push({
                    code: `${letter}-${no}`,
                    grade: _grades[0]
                })
            })
        }

        return seats;
    }

    /**
     * スクリーンを初期化する
     */
    public createScreens(): void {
        mongoose.connect(MONGOLAB_URI, {});

        let theaters = [
            '5750f5600b08d7700b973021',
            '5775b0f0cd62cab416b4b361',
            '5775b1bacd62cab416b4b363',
        ];


        let screens = [
        ];

        theaters.forEach((theater) => {
            for (let i = 0; i < 10; i++) {
                let no = i + 1;

                screens.push({
                    theater: theater,
                    name: `スクリーン${no}`,
                    name_en: `SCREEN${no}`,
                    sections: [
                        {
                            code: 'SEC00',
                            name: 'セクション00',
                            name_en: 'Section00',
                            seats: this.getSeats()
                        }
                    ],
                    created_user: 'system',
                    updated_user: 'system',
                });
            }
        });


        this.logger.debug('removing all screens...');
        Models.Screen.remove({}, (err) => {
            this.logger.debug('creating screens...');
            Models.Screen.create(
                screens,
                (err, screenDocuments) => {
                    this.logger.debug('screens created.');

                    mongoose.disconnect();

                    if (err) {
                    } else {
                        this.logger.debug('success!');
                        process.exit(0);
                    }
                }
            );
        });
    }

    /**
     * パフォーマンスを初期化する
     */
    public createPerformances() {
        mongoose.connect(MONGOLAB_URI, {});

        let performances = [];

        // 作品ごとのパフォーマンス数(最大3つになるように制御)
        let performancesByFilm = {};

        Models.Film.find({}, '_id', (err, filmDocuments) => {
            Models.Screen.find({}, '_id theater', (err, screenDocuments) => {
                let days = ['20161022', '20161023', '20161024', '20161025', '20161026', '20161027', '20161028'];
                let starts = ['0900', '1200', '1500', '1800'];
                let ends = ['1100', '1400', '1700', '2000'];

                // スクリーンごとに4時間帯のスケジュールを登録する
                screenDocuments.forEach((screen) => {
                    this.logger.debug('performances length:', performances.length);
                    days.forEach((day) => {
                        starts.forEach((start, index) => {



                            // 作品を選考する
                            this.logger.debug('selecting film...');
                            let _filmId;
                            while (_filmId === undefined) {
                                let _filmDocuments = this.shuffle(filmDocuments);
                                let _film = _filmDocuments[0];

                                if (performancesByFilm.hasOwnProperty(_film.get('_id'))) {
                                    if (performancesByFilm[_film.get('_id')].length > 2) {
                                        continue;
                                    } else {
                                        performancesByFilm[_film.get('_id')].push('performance');
                                        _filmId = _film.get('_id');
                                    }
                                } else {
                                    performancesByFilm[_film.get('_id')] = [];
                                    performancesByFilm[_film.get('_id')].push('performance');
                                    _filmId = _film.get('_id');
                                }
                            }



                            this.logger.debug('pushing performance...');
                            performances.push({
                                theater: screen.get('theater'),
                                screen: screen.get('_id'),
                                film: _filmId,
                                day: day,
                                start_time: start,
                                end_time: ends[index],
                                is_mx4d: this.shuffle([true, false, false, false])[0],
                                created_user: 'system',
                                updated_user: 'system'
                            });
                        });
                    });
                });




                // 全削除して一気に作成
                this.logger.debug('removing all performances...');
                Models.Performance.remove({}, (err) => {
                    this.logger.debug('creating performances...');
                    Models.Performance.create(
                        performances,
                        (err, performanceDocuments) => {
                            this.logger.debug('performances created.');

                            mongoose.disconnect();

                            if (err) {
                            } else {
                            }

                            this.logger.debug('success!');
                            process.exit(0);
                        }
                    );
                });

            });
        });
    }

    /**
     * 予約を初期化する
     */
    public resetReservations(): void {
        mongoose.connect(MONGOLAB_URI, {});

        Models.Reservation.remove({}, (err) => {
            this.logger.info('remove processed.', err);

            mongoose.disconnect();
            process.exit(0);
        });
    }

    public calculatePerformanceStatuses() {
        mongoose.connect(MONGOLAB_URI, {});

        Models.Performance.find(
            {},
            'day start_time screen'
        ).populate('screen', 'sections')
        .exec((err, performanceDocuments) => {
            let promises = [];
            let now = moment().format('YYYYMMDDHHmm');
            let performanceStatusesModel = new PerformanceStatusesModel();

            performanceDocuments.forEach((performanceDocument) => {
                // パフォーマンスごとに空席割合を算出する
                promises.push(new Promise((resolve, reject) => {
                    Models.Reservation.count(
                        {
                            performance: performanceDocument.get('_id')
                        }
                        ,(err, reservationCount) => {
                            if (err) {

                            } else {
                                console.log(reservationCount);

                                let seatCount = performanceDocument.get('screen').get('sections')[0].seats.length;
                                let start = performanceDocument.get('day') + performanceDocument.get('start_time');
                                let status = PerformanceUtil.seatNum2status(reservationCount, seatCount, start, now);
                                performanceStatusesModel.setStatus(performanceDocument.get('_id'), status);

                            }

                            resolve();

                        }
                    );

                }));

            });


            Promise.all(promises).then(() => {
                performanceStatusesModel.save((err) => {
                    this.logger.debug('success!');
                    mongoose.disconnect();
                    process.exit(0);
                });

            }, (err) => {
                this.logger.debug('fail.');
                mongoose.disconnect();
                process.exit(0);

            });
        });
    }

    /**
     * 固定日時を経過したら、空席ステータスにするバッチ
     */
    public releaseSeatsKeptByMembers() {
        let now = moment();
        if (moment(Constants.RESERVE_END_DATETIME) < now) {
            mongoose.connect(MONGOLAB_URI, {});

            this.logger.info('releasing reservations kept by members...');
            Models.Reservation.remove(
                {
                    status: ReservationUtil.STATUS_KEPT_BY_MEMBER
                },
                (err) => {
                    // 失敗しても、次のタスクにまかせる(気にしない)
                    if (err) {
                    } else {
                    }

                    mongoose.disconnect();
                    process.exit(0);
                }
            );
        } else {
            process.exit(0);            
        }
    }

    /**
     * 作品画像を取得する
     */
    public getFilmImages() {
        mongoose.connect(MONGOLAB_URI, {});

        Models.Film.find({}, 'name', (err, filmDocuments) => {

            let next = (filmDocument) => {
                let options = {
                    url: `https://api.photozou.jp/rest/search_public.json?limit=1&keyword=${encodeURIComponent(filmDocument.get('name'))}`,
                    json: true
                };

                console.log(options.url);

                request.get(options, (error, response, body) => {
                    if (!error && response.statusCode == 200) {
                        if (body.stat === 'ok' && body.info.photo) {
                            console.log(body.info.photo[0].image_url)
                            let image = body.info.photo[0].image_url

                            // 画像情報更新
                            Models.Film.update(
                                {
                                    _id: filmDocument.get('_id')
                                },
                                {
                                    image: image
                                },
                                (err) => {
                                    this.logger.debug('film udpated.');

                                    if (i === filmDocuments.length - 1) {
                                        this.logger.debug('success!');

                                        mongoose.disconnect();
                                        process.exit(0);

                                    } else {
                                        i++;
                                        next(filmDocuments[i]);

                                    }

                                }
                            );

                        } else {
                            i++;
                            next(filmDocuments[i]);

                        }

                    } else {
                        i++;
                        next(filmDocuments[i]);

                    }
                })


            }

            let i = 0;
            next(filmDocuments[i]);

        });
    }

    /**
     * 予約完了メールを送信する
     */
    public sendCompleteEmail(): void {
        mongoose.connect(MONGOLAB_URI, {});

        let promises = [];

        this.logger.info('finding reservationEmailCues...');
        Models.ReservationEmailCue.find(
            {
                is_sent: false
            }
        ).limit(10).exec((err, cueDocuments) => {
            this.logger.info('reservationEmailCues found.', err, cueDocuments);

            if (err) {
                mongoose.disconnect();
                process.exit(0);
                return;
            }

            if (cueDocuments.length === 0) {
                mongoose.disconnect();
                process.exit(0);
                return;
            }

            let _sendgrid = sendgrid(conf.get<string>('sendgrid_username'), conf.get<string>('sendgrid_password'));

            let next = (i: number) => {
                if (i === cueDocuments.length) {
                    mongoose.disconnect();
                    process.exit(0);
                    return;

                }

                let cueDocument = cueDocuments[i];

                // 予約ロガーを取得
                Util.getReservationLogger(cueDocument.get('payment_no'), (err, logger) => {
                    if (err) {
                        // 失敗したらデフォルトロガーに逃げる

                    } else {
                        this.logger = logger;
                    }

                    // 送信
                    Models.Reservation.find(
                        {
                            payment_no: cueDocument.get('payment_no'),
                            status: ReservationUtil.STATUS_RESERVED
                        },
                        (err, reservationDocuments) => {
                            if (err) {
                                i++;
                                next(i);

                            } else {
                                if (reservationDocuments.length === 0) {
                                    // 送信済みフラグを立てる
                                    cueDocument.set('is_sent', true);
                                    cueDocument.save((err, res) => {
                                        i++;
                                        next(i);

                                    });
                                    
                                } else {
                                    let to = '';
                                    let purchaserGroup = reservationDocuments[0].get('purchaser_group');
                                    switch (purchaserGroup) {
                                        case ReservationUtil.PURCHASER_GROUP_CUSTOMER:
                                        case ReservationUtil.PURCHASER_GROUP_MEMBER:
                                        case ReservationUtil.PURCHASER_GROUP_SPONSOR:
                                            to = reservationDocuments[0].get('purchaser_email')
                                            break;

                                        case ReservationUtil.PURCHASER_GROUP_STAFF:
                                            to = reservationDocuments[0].get('staff_email')
                                            break;

                                        default:
                                            break;

                                    }


                                    if (!to) {
                                        mongoose.disconnect();
                                        process.exit(0);
                                        return;

                                    }

                                    let EmailTemplate = emailTemplates.EmailTemplate
                                    var path = require('path')

                                    let dir = `${__dirname}/../../views/email/reserveComplete`;

                                    let template = new EmailTemplate(dir);
                                    let locals = {
                                        reservationDocuments: reservationDocuments
                                    };
                                    template.render(locals, (err, result) => {
                                        if (err) {
                                            i++;
                                            next(i);

                                        } else {
                                            let email = new _sendgrid.Email({
                                                to: to,
                                                from: 'noreply@devtiffwebapp.azurewebsites.net',
                                                subject: `[TIFF][${process.env.NODE_ENV}] 予約完了`,
                                                html: result.html
                                            });


                                            // add barcodes
                                            for (let reservationDocument of reservationDocuments) {
                                                let reservationId = reservationDocument.get('_id').toString();

                                                email.addFile({
                                                    filename: `QR_${reservationId}.png`,
                                                    contentType: 'image/png',
                                                    cid: `qrcode_${reservationId}`,
                                                    content: ReservationUtil.createQRCode(reservationId)
                                                });
                                            }


                                            this.logger.info('sending an email...email:', email);
                                            _sendgrid.send(email, (err, json) => {
                                                this.logger.info('an email sent.', err, json);

                                                if (err) {
                                                    i++;
                                                    next(i);

                                                } else {
                                                    // 送信済みフラグを立てる
                                                    cueDocument.set('is_sent', true);
                                                    cueDocument.save((err, res) => {
                                                        i++;
                                                        next(i);

                                                    });

                                                }

                                            });

                                        }

                                    });
                                }

                            }

                        }
                    );

                });
            }

            let i = 0;
            next(i);

        });

    }

    public upsertReservation(): void {
        mongoose.connect(MONGOLAB_URI, {});

        let promises = [];

        for (let i = 0; i < 3; i++) {
            promises.push(new Promise((resolve, reject) => {
                this.logger.debug('updating reservation...');
                Models.Reservation.findOneAndUpdate(
                    {
                        performance: "57a7c71e59e0a513283e0507",
                        seat_code: "A-2"
                    },
                    {
                        $set: {
                            status: ReservationUtil.STATUS_TEMPORARY
                        },
                        $setOnInsert: {
                        }
                    },
                    {
                        upsert: true,
                        new: true
                    },
                    (err, reservationDocument) => {
                        this.logger.debug('reservation updated.', err, reservationDocument);

                        resolve();

                    }
                );
            }));
        }


        Promise.all(promises).then(() => {
            mongoose.disconnect();
            process.exit(0);

        }, (err) => {

        });
    }

    public createIndexes() {
        let MongoClient = mongodb.MongoClient;
        MongoClient.connect(conf.get<string>('mongolab_uri'), (err, db) => {
            let promises = [];

            promises.push(new Promise((resolve, reject) => {
                db.collection('reservations').createIndex(
                    {
                        performance: 1,
                        seat_code: 1
                    },
                    {
                        unique: true
                    },
                    (err) => {
                        this.logger.debug('index created.', err);
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    }
                );
            }));

            promises.push(new Promise((resolve, reject) => {
                db.collection('reservation_email_cues').createIndex(
                    {
                        payment_no: 1,
                    },
                    {
                        unique: true
                    },
                    (err) => {
                        this.logger.debug('index created.', err);
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    }
                );
            }));

            promises.push(new Promise((resolve, reject) => {
                db.collection('staffs').createIndex(
                    {
                        user_id: 1,
                    },
                    {
                        unique: true
                    },
                    (err) => {
                        this.logger.debug('index created.', err);
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    }
                );
            }));

            promises.push(new Promise((resolve, reject) => {
                db.collection('sponsors').createIndex(
                    {
                        user_id: 1,
                    },
                    {
                        unique: true
                    },
                    (err) => {
                        this.logger.debug('index created.', err);
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    }
                );
            }));



            Promise.all(promises).then(() => {
                this.logger.debug('success!');
                db.close();
                process.exit(0);

            }, (err) => {
                db.close();
                process.exit(0);

            });
        });
    }

    public createSponsors(): void {
        mongoose.connect(MONGOLAB_URI, {});

        let password_salt = Util.createToken();
        Models.Sponsor.create(
            {
                user_id: 'motionpicture',
                password_salt: password_salt,
                password_hash: Util.createHash('password', password_salt),
                name: 'モーションピクチャーというスポンサー',
                max_reservation_count: 50,
                performance: '57a3d45ddfada98420a623b2'
            },
            () => {
                mongoose.disconnect();
                process.exit(0);
            }
        );
    }

    public createMemberReservations() {
        mongoose.connect(MONGOLAB_URI, {});

        Models.Performance.findOne().populate('screen').exec((err, performance) => {
            let seats = performance.get('screen').sections[0].seats;

            // 適当に座席を2つ選択
            seats = this.shuffle(seats);

            // 購入番号を発行
            Models.Sequence.findOneAndUpdate(
                {
                    target: 'payment_no'
                },
                {
                    $inc: {
                        no: 1
                    }
                },
                {
                    new: true
                },
                (err, sequenceDocument) => {
                    if (err) {
                        mongoose.disconnect();
                        process.exit(0);

                    } else {
                        let no: number = sequenceDocument.get('no');
                        let paymentNo = `${no}${Util.getCheckDigit(no)}`;

                        let newReservation1 = {
                            performance: performance.get('_id'),
                            seat_code: seats[0].code,
                            payment_no: paymentNo,
                            purchaser_group: ReservationUtil.PURCHASER_GROUP_MEMBER,
                            status: ReservationUtil.STATUS_KEPT_BY_MEMBER,
                            member: '57723c84e037e2bc26e2bcd0'
                        }
                        let newReservation2 = {
                            performance: performance.get('_id'),
                            seat_code: seats[1].code,
                            payment_no: paymentNo,
                            purchaser_group: ReservationUtil.PURCHASER_GROUP_MEMBER,
                            status: ReservationUtil.STATUS_KEPT_BY_MEMBER,
                            member: '57723c84e037e2bc26e2bcd0'
                        }

                        Models.Reservation.create(newReservation1, newReservation2, (err, reservation1, reservation2) => {
                            this.logger.debug('reservations created.', err, reservation1, reservation2);

                            mongoose.disconnect();
                            process.exit(0);
                        })
                    }
                }
            );
        });
    }
}
