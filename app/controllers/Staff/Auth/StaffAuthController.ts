import { Models } from '@motionpicture/ttts-domain';
import Util from '../../../../common/Util/Util';
import staffLoginForm from '../../../forms/staff/staffLoginForm';
import StaffUser from '../../../models/User/StaffUser';
import BaseController from '../../BaseController';

export default class StaffAuthController extends BaseController {
    public layout = 'layouts/staff/layout';

    /**
     * 内部関係者ログイン
     */
    public login(): void {
        if (this.req.staffUser.isAuthenticated()) {
            return this.res.redirect(this.router.build('staff.mypage'));
        }

        if (this.req.method === 'POST') {
            const form = staffLoginForm(this.req);
            form(this.req, this.res, (err) => {
                if (this.req.form.isValid) {

                    // ユーザー認証
                    this.logger.debug('finding staff... user_id:', (<any>this.req.form).userId);
                    Models.Staff.findOne(
                        {
                            user_id: (<any>this.req.form).userId
                        },
                        (findStaffErr, staff) => {
                            if (findStaffErr) return this.next(new Error(this.req.__('Message.UnexpectedError')));

                            if (!staff) {
                                this.req.form.errors.push(this.req.__('Message.invalid{{fieldName}}', { fieldName: this.req.__('Form.FieldName.password') }));
                                this.res.render('staff/auth/login');
                            } else {
                                // パスワードチェック
                                if (staff.get('password_hash') !== Util.createHash((<any>this.req.form).password, staff.get('password_salt'))) {
                                    this.req.form.errors.push(this.req.__('Message.invalid{{fieldName}}', { fieldName: this.req.__('Form.FieldName.password') }));
                                    this.res.render('staff/auth/login');

                                } else {
                                    // ログイン記憶
                                    const processRemember = (cb: (err: Error, token: string) => void) => {
                                        if ((<any>this.req.form).remember) {
                                            // トークン生成
                                            Models.Authentication.create(
                                                {
                                                    token: Util.createToken(),
                                                    staff: staff.get('_id'),
                                                    signature: (<any>this.req.form).signature,
                                                    locale: (<any>this.req.form).language
                                                },
                                                (createAuthenticationErr, authentication) => {
                                                    this.res.cookie('remember_staff', authentication.get('token'), { path: '/', httpOnly: true, maxAge: 604800000 });
                                                    cb(createAuthenticationErr, authentication.get('token'));
                                                }
                                            );
                                        } else {
                                            cb(null, null);
                                        }
                                    };

                                    processRemember((processRememberErr, token) => {
                                        if (processRememberErr) return this.next(new Error(this.req.__('Message.UnexpectedError')));

                                        this.req.session[StaffUser.AUTH_SESSION_NAME] = staff.toObject();
                                        this.req.session[StaffUser.AUTH_SESSION_NAME].signature = (<any>this.req.form).signature;
                                        this.req.session[StaffUser.AUTH_SESSION_NAME].locale = (<any>this.req.form).language;

                                        // if exist parameter cb, redirect to cb.
                                        const cb = (this.req.query.cb) ? this.req.query.cb : this.router.build('staff.mypage');
                                        this.res.redirect(cb);
                                    });
                                }

                            }
                        }
                    );

                } else {
                    this.res.render('staff/auth/login');

                }

            });
        } else {
            this.res.locals.userId = '';
            this.res.locals.password = '';
            this.res.locals.signature = '';

            this.res.render('staff/auth/login');
        }
    }

    public logout(): void {
        delete this.req.session[StaffUser.AUTH_SESSION_NAME];
        Models.Authentication.remove({ token: this.req.cookies.remember_staff }, (err) => {
            this.res.clearCookie('remember_staff');
            this.res.redirect(this.router.build('staff.mypage'));
        });
    }
}
