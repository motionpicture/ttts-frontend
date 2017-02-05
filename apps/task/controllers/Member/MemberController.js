"use strict";
const BaseController_1 = require("../BaseController");
const Util_1 = require("../../../common/Util/Util");
const Models_1 = require("../../../common/models/Models");
const conf = require("config");
const mongoose = require("mongoose");
const fs = require("fs-extra");
let MONGOLAB_URI = conf.get('mongolab_uri');
class MemberController extends BaseController_1.default {
    createFromJson() {
        mongoose.connect(MONGOLAB_URI, {});
        fs.readFile(`${process.cwd()}/data/${process.env.NODE_ENV}/members.json`, 'utf8', (err, data) => {
            if (err)
                throw err;
            let members = JSON.parse(data);
            // パスワードハッシュ化
            members = members.map((member) => {
                let password_salt = Util_1.default.createToken();
                return {
                    "user_id": member.user_id,
                    "password_salt": password_salt,
                    "password_hash": Util_1.default.createHash(member.password, password_salt)
                };
            });
            this.logger.info('removing all members...');
            Models_1.default.Member.remove({}, (err) => {
                this.logger.debug('creating members...');
                Models_1.default.Member.create(members, (err) => {
                    this.logger.info('members created.', err);
                    mongoose.disconnect();
                    process.exit(0);
                });
            });
        });
    }
    createReservationsFromJson() {
        mongoose.connect(MONGOLAB_URI, {});
        fs.readFile(`${process.cwd()}/data/${process.env.NODE_ENV}/memberReservations.json`, 'utf8', (err, data) => {
            if (err)
                throw err;
            let reservations = JSON.parse(data);
            this.logger.debug('creating reservations...');
            let promises = reservations.map((reservationFromJson) => {
                return new Promise((resolve, reject) => {
                    this.logger.info('removing reservation...');
                    // すでに予約があれば削除してから新規作成
                    Models_1.default.Reservation.remove({
                        performance: reservationFromJson.performance,
                        seat_code: reservationFromJson.seat_code
                    }, (err) => {
                        this.logger.info('reservation removed.', err);
                        if (err)
                            return reject(err);
                        this.logger.info('creating reservationFromJson...', reservationFromJson);
                        Models_1.default.Reservation.create(reservationFromJson, (err) => {
                            this.logger.info('reservationFromJson created.', err);
                            (err) ? reject(err) : resolve();
                        });
                    });
                });
            });
            Promise.all(promises).then(() => {
                this.logger.info('promised.');
                mongoose.disconnect();
                process.exit(0);
            }).catch((err) => {
                this.logger.info('promised.', err);
                mongoose.disconnect();
                process.exit(0);
            });
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = MemberController;
