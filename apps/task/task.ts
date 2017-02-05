import program = require('commander');
import AnalysisController from './controllers/Analysis/AnalysisController';
import TestController from './controllers/Test/TestController';
import StaffController from './controllers/Staff/StaffController';
import SponsorController from './controllers/Sponsor/SponsorController';
import PerformanceController from './controllers/Performance/PerformanceController';
import TheaterController from './controllers/Theater/TheaterController';
import FilmController from './controllers/Film/FilmController';
import MemberController from './controllers/Member/MemberController';
import ReservationController from './controllers/Reservation/ReservationController';
import SchemaController from './controllers/Schema/SchemaController';
import TelController from './controllers/Tel/TelController';
import WindowController from './controllers/Window/WindowController';
// import LogController from './controllers/Log/LogController';
import PreCustomerController from './controllers/PreCustomer/PreCustomerController';
import GMOController from './controllers/GMO/GMOController';
import ReservationEmailCueController from './controllers/ReservationEmailCue/ReservationEmailCueController';

let env = process.env.NODE_ENV || 'dev';

program
    .version('0.0.1')

program
    .command('test <method>')
    .description('テストタスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/Test${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new TestController(logDir))[method]();
    });

program
    .command('analysis <method>')
    .description('分析タスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/Analysis${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new AnalysisController(logDir))[method]();
    });

program
    .command('gmo <method>')
    .description('GMO結果通知処理タスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/GMO${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new GMOController(logDir))[method]();
    });

program
    .command('staff <method>')
    .description('内部関係者タスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/Staff${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new StaffController(logDir))[method]();
    });

program
    .command('createStaffReservationsByPerformanceId <performanceId>')
    .description('パフォーマンス指定で内部関係者の先抑えを行うタスク')
    .action((performanceId) => {
        let logDir = `${__dirname}/../../logs/${env}/task/StaffCreateReservationsByPerformanceId`;
        (new StaffController(logDir)).createReservationsByPerformanceId(performanceId);
    });

program
    .command('sponsor <method>')
    .description('外部関係者タスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/Sponsor${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new SponsorController(logDir))[method]();
    });

program
    .command('preCustomer <method>')
    .description('1.5次販売ユーザータスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/PreCustomer${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new PreCustomerController(logDir))[method]();
    });

program
    .command('performance <method>')
    .description('パフォーマンスタスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/Performance${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new PerformanceController(logDir))[method]();
    });

program
    .command('releasePerformance <performanceId>')
    .description('ID指定でパフォーマンスを公開するタスク')
    .action((performanceId) => {
        let logDir = `${__dirname}/../../logs/${env}/task/PerformanceRelease`;
        (new PerformanceController(logDir)).release(performanceId);
    });

program
    .command('theater <method>')
    .description('劇場タスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/Theater${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new TheaterController(logDir))[method]();
    });

program
    .command('film <method>')
    .description('作品タスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/Film${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new FilmController(logDir))[method]();
    });

program
    .command('member <method>')
    .description('メルマガ会員タスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/Member${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new MemberController(logDir))[method]();
    });

program
    .command('tel <method>')
    .description('電話窓口タスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/Tel${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new TelController(logDir))[method]();
    });

program
    .command('window <method>')
    .description('当日窓口タスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/Window${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new WindowController(logDir))[method]();
    });

program
    .command('reservation <method>')
    .description('予約関連タスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/Reservation${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new ReservationController(logDir))[method]();
    });

program
    .command('reservationEmailCue <method>')
    .description('予約メール関連タスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/ReservationEmailCue${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new ReservationEmailCueController(logDir))[method]();
    });

program
    .command('schema <method>')
    .description('スキーマ関連タスク')
    .action((method) => {
        let logDir = `${__dirname}/../../logs/${env}/task/Schema${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        (new SchemaController(logDir))[method]();
    });

// program
//     .command('log <method>')
//     .description('ログ関連タスク')
//     .action((method) => {
//         let logDir = `${__dirname}/../../logs/${env}/task/Log${method.charAt(0).toUpperCase()}${method.slice(1)}`;
//         (new LogController(logDir))[method]();
//     });

// program
//   .command('*')
//   .action(function(env){
//     console.log('deploying "%s"', env);
//   });

program.parse(process.argv);