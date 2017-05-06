"use strict";
/**
 * 当日窓口ルーター
 *
 * @function routes/window
 * @ignore
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
const chevre_domain_1 = require("@motionpicture/chevre-domain");
const windowAuthController = require("../controllers/window/auth");
const windowCancelController = require("../controllers/window/cancel");
const windowMyPageController = require("../controllers/window/mypage");
const windowReserveController = require("../controllers/window/reserve");
const window_1 = require("../models/user/window");
exports.default = (app) => {
    const authentication = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
        if (req.windowUser === undefined) {
            next(new Error(req.__('Message.UnexpectedError')));
            return;
        }
        // 既ログインの場合
        if (req.windowUser.isAuthenticated()) {
            // 言語設定
            if (req.windowUser.get('locale') !== undefined && req.windowUser.get('locale') !== null) {
                req.setLocale(req.windowUser.get('locale'));
            }
            next();
            return;
        }
        // 自動ログインチェック
        const checkRemember = () => __awaiter(this, void 0, void 0, function* () {
            if (req.cookies.remember_window === undefined) {
                return null;
            }
            try {
                const authenticationDoc = yield chevre_domain_1.Models.Authentication.findOne({
                    token: req.cookies.remember_window,
                    window: { $ne: null }
                }).exec();
                if (authenticationDoc === null) {
                    res.clearCookie('remember_window');
                    return null;
                }
                // トークン再生成
                const token = chevre_domain_1.CommonUtil.createToken();
                yield authenticationDoc.update({ token: token }).exec();
                // tslint:disable-next-line:no-cookies
                res.cookie('remember_window', token, { path: '/', httpOnly: true, maxAge: 604800000 });
                return yield chevre_domain_1.Models.Window.findOne({ _id: authenticationDoc.get('window') }).exec();
            }
            catch (error) {
                return null;
            }
        });
        const user = yield checkRemember();
        if (user !== null && req.session !== undefined) {
            // ログインしてリダイレクト
            req.session[window_1.default.AUTH_SESSION_NAME] = user.toObject();
            res.redirect(req.originalUrl);
        }
        else {
            if (req.xhr) {
                res.json({
                    success: false,
                    message: 'login required'
                });
            }
            else {
                res.redirect(`/window/login?cb=${req.originalUrl}`);
            }
        }
    });
    const base = (req, __, next) => {
        // 基本的に日本語
        req.setLocale('ja');
        req.windowUser = window_1.default.parse(req.session);
        next();
    };
    app.all('/window/login', base, windowAuthController.login);
    app.all('/window/logout', base, windowAuthController.logout);
    app.all('/window/mypage', base, authentication, windowMyPageController.index);
    app.get('/window/mypage/search', base, authentication, windowMyPageController.search);
    app.get('/window/reserve/start', base, authentication, windowReserveController.start);
    app.all('/window/reserve/terms', base, authentication, windowReserveController.terms);
    app.all('/window/reserve/performances', base, authentication, windowReserveController.performances);
    app.all('/window/reserve/seats', base, authentication, windowReserveController.seats);
    app.all('/window/reserve/tickets', base, authentication, windowReserveController.tickets);
    app.all('/window/reserve/profile', base, authentication, windowReserveController.profile);
    app.all('/window/reserve/confirm', base, authentication, windowReserveController.confirm);
    app.get('/window/reserve/:performanceDay/:paymentNo/complete', base, authentication, windowReserveController.complete);
    app.post('/window/cancel/execute', base, authentication, windowCancelController.execute);
};
