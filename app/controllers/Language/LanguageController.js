"use strict";
const BaseController_1 = require("../BaseController");
/**
 * 言語コントローラー
 *
 * @export
 * @class LanguageController
 * @extends {BaseController}
 */
class LanguageController extends BaseController_1.default {
    /**
     * 言語切り替え
     */
    update() {
        const locale = this.req.params.locale;
        this.req.session.locale = locale;
        const cb = (this.req.query.cb) ? this.req.query.cb : '/';
        this.res.redirect(cb);
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = LanguageController;