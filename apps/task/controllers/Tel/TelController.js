"use strict";
const BaseController_1 = require("../BaseController");
const Util_1 = require("../../../common/Util/Util");
const Models_1 = require("../../../common/models/Models");
const conf = require("config");
const mongoose = require("mongoose");
const fs = require("fs-extra");
let MONGOLAB_URI = conf.get('mongolab_uri');
class TelController extends BaseController_1.default {
    createFromJson() {
        mongoose.connect(MONGOLAB_URI, {});
        fs.readFile(`${process.cwd()}/data/${process.env.NODE_ENV}/telStaffs.json`, 'utf8', (err, data) => {
            if (err)
                throw err;
            let telStaffs = JSON.parse(data);
            // パスワードハッシュ化
            telStaffs = telStaffs.map((telStaff) => {
                let password_salt = Util_1.default.createToken();
                telStaff.password_salt = password_salt;
                telStaff.password_hash = Util_1.default.createHash(telStaff.password, password_salt);
                return telStaff;
            });
            this.logger.info('removing all telStaffs...');
            Models_1.default.TelStaff.remove({}, (err) => {
                if (err) {
                    this.logger.info('telStaffs removed.', err);
                    mongoose.disconnect();
                    process.exit(0);
                    return;
                }
                this.logger.debug('creating telStaffs...');
                Models_1.default.TelStaff.create(telStaffs, (err) => {
                    this.logger.info('telStaffs created.', err);
                    mongoose.disconnect();
                    process.exit(0);
                });
            });
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TelController;
