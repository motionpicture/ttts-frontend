"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const chevre_domain_1 = require("@motionpicture/chevre-domain");
const _ = require("underscore");
const Util = require("../../../../common/Util/Util");
const staffLoginForm_1 = require("../../../forms/staff/staffLoginForm");
const StaffUser_1 = require("../../../models/User/StaffUser");
const BaseController_1 = require("../../BaseController");
/**
 * 内部関係者認証コントローラー
 *
 * @export
 * @class StaffAuthController
 * @extends {BaseController}
 */
class StaffAuthController extends BaseController_1.default {
    constructor() {
        super(...arguments);
        this.layout = 'layouts/staff/layout';
    }
    /**
     * 内部関係者ログイン
     */
    login() {
        if (this.req.staffUser !== undefined && this.req.staffUser.isAuthenticated()) {
            this.res.redirect(this.router.build('staff.mypage'));
            return;
        }
        if (this.req.method === 'POST') {
            staffLoginForm_1.default(this.req)(this.req, this.res, () => __awaiter(this, void 0, void 0, function* () {
                const form = this.req.form;
                if (form !== undefined && form.isValid) {
                    try {
                        // ユーザー認証
                        this.logger.debug('finding staff... user_id:', form.userId);
                        const staff = yield chevre_domain_1.Models.Staff.findOne({
                            user_id: form.userId
                        }).exec();
                        if (staff === null) {
                            form.errors.push(this.req.__('Message.invalid{{fieldName}}', { fieldName: this.req.__('Form.FieldName.password') }));
                            this.res.render('staff/auth/login');
                            return;
                        }
                        // パスワードチェック
                        if (staff.get('password_hash') !== Util.createHash(form.password, staff.get('password_salt'))) {
                            form.errors.push(this.req.__('Message.invalid{{fieldName}}', { fieldName: this.req.__('Form.FieldName.password') }));
                            this.res.render('staff/auth/login');
                            return;
                        }
                        // ログイン記憶
                        if (form.remember === 'on') {
                            // トークン生成
                            const authentication = yield chevre_domain_1.Models.Authentication.create({
                                token: Util.createToken(),
                                staff: staff.get('_id'),
                                signature: form.signature,
                                locale: form.language
                            });
                            // tslint:disable-next-line:no-cookies
                            this.res.cookie('remember_staff', authentication.get('token'), { path: '/', httpOnly: true, maxAge: 604800000 });
                        }
                        // ログイン
                        this.req.session[StaffUser_1.default.AUTH_SESSION_NAME] = staff.toObject();
                        this.req.session[StaffUser_1.default.AUTH_SESSION_NAME].signature = form.signature;
                        this.req.session[StaffUser_1.default.AUTH_SESSION_NAME].locale = form.language;
                        const cb = (!_.isEmpty(this.req.query.cb)) ? this.req.query.cb : this.router.build('staff.mypage');
                        this.res.redirect(cb);
                    }
                    catch (error) {
                        this.next(new Error(this.req.__('Message.UnexpectedError')));
                    }
                }
                else {
                    this.res.render('staff/auth/login');
                }
            }));
        }
        else {
            this.res.locals.userId = '';
            this.res.locals.password = '';
            this.res.locals.signature = '';
            this.res.render('staff/auth/login');
        }
    }
    logout() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (this.req.session === undefined) {
                    this.next(new Error(this.req.__('Message.UnexpectedError')));
                    return;
                }
                delete this.req.session[StaffUser_1.default.AUTH_SESSION_NAME];
                yield chevre_domain_1.Models.Authentication.remove({ token: this.req.cookies.remember_staff }).exec();
                this.res.clearCookie('remember_staff');
                this.res.redirect(this.router.build('staff.mypage'));
            }
            catch (error) {
                this.next(error);
            }
        });
    }
}
exports.default = StaffAuthController;
