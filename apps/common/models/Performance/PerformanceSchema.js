"use strict";
const mongoose = require("mongoose");
const PerformanceUtil_1 = require("./PerformanceUtil");
const moment = require("moment");
/**
 * パフォーマンススキーマ
 */
let Schema = new mongoose.Schema({
    _id: String,
    theater: {
        type: String,
        ref: 'Theater'
    },
    theater_name: {
        ja: String,
        en: String,
    },
    screen: {
        type: String,
        ref: 'Screen'
    },
    screen_name: {
        ja: String,
        en: String,
    },
    film: {
        type: String,
        ref: 'Film'
    },
    day: String,
    open_time: String,
    start_time: String,
    end_time: String,
    canceled: Boolean // 上映中止フラグ 
}, {
    collection: 'performances',
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    }
});
/** 開始文字列を表示形式で取得 */
Schema.virtual('start_str_ja').get(function () {
    return `${this.day.substr(0, 4)}/${this.day.substr(4, 2)}/${this.day.substr(6)} 開場 ${this.open_time.substr(0, 2)}:${this.open_time.substr(2)} 開演 ${this.start_time.substr(0, 2)}:${this.start_time.substr(2)}`;
});
Schema.virtual('start_str_en').get(function () {
    let date = `${moment(`${this.day.substr(0, 4)}-${this.day.substr(4, 2)}-${this.day.substr(6)}T00:00:00+09:00`).format('MMMM DD, YYYY')}`;
    return `Open: ${this.open_time.substr(0, 2)}:${this.open_time.substr(2)}/Start: ${this.start_time.substr(0, 2)}:${this.start_time.substr(2)} on ${date}`;
});
Schema.virtual('location_str_ja').get(function () {
    return `${this.get('theater_name')['ja']} ${this.get('screen_name')['ja']}`;
});
Schema.virtual('location_str_en').get(function () {
    return `at ${this.get('screen_name')['en']}, ${this.get('theater_name')['en']}`;
});
/**
 * 空席ステータスを算出する
 *
 * @param {string} reservationNumber 予約数
 */
Schema.methods.getSeatStatus = function (reservationNumber) {
    // 上映日当日過ぎていればG
    if (parseInt(this.day) < parseInt(moment().format('YYYYMMDD')))
        return PerformanceUtil_1.default.SEAT_STATUS_G;
    // 残席0以下なら問答無用に×
    let availableSeatNum = this.screen.seats_number - reservationNumber;
    if (availableSeatNum <= 0)
        return PerformanceUtil_1.default.SEAT_STATUS_C;
    // 残席数よりステータスを算出
    let seatNum = 100 * availableSeatNum;
    if (PerformanceUtil_1.default.SEAT_STATUS_THRESHOLD_A * this.screen.seats_number < seatNum)
        return PerformanceUtil_1.default.SEAT_STATUS_A;
    if (PerformanceUtil_1.default.SEAT_STATUS_THRESHOLD_B * this.screen.seats_number < seatNum)
        return PerformanceUtil_1.default.SEAT_STATUS_B;
    return PerformanceUtil_1.default.SEAT_STATUS_C;
};
Schema.index({
    day: 1,
    start_time: 1
});
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Schema;
