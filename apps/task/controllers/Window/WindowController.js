"use strict";
const BaseController_1 = require("../BaseController");
const Util_1 = require("../../../common/Util/Util");
const Models_1 = require("../../../common/models/Models");
const conf = require("config");
const mongoose = require("mongoose");
const fs = require("fs-extra");
let MONGOLAB_URI = conf.get('mongolab_uri');
class WindowController extends BaseController_1.default {
    createFromJson() {
        mongoose.connect(MONGOLAB_URI, {});
        fs.readFile(`${process.cwd()}/data/${process.env.NODE_ENV}/windows.json`, 'utf8', (err, data) => {
            if (err)
                throw err;
            let windows = JSON.parse(data);
            // パスワードハッシュ化
            windows = windows.map((window) => {
                let password_salt = Util_1.default.createToken();
                window.password_salt = password_salt;
                window.password_hash = Util_1.default.createHash(window.password, password_salt);
                return window;
            });
            this.logger.info('removing all windows...');
            Models_1.default.Window.remove({}, (err) => {
                this.logger.debug('creating windows...');
                Models_1.default.Window.create(windows, (err) => {
                    this.logger.info('windows created.', err);
                    mongoose.disconnect();
                    process.exit(0);
                });
            });
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = WindowController;
