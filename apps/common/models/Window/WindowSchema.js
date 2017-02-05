"use strict";
const mongoose = require("mongoose");
/**
 * 窓口担当者スキーマ
 */
let Schema = new mongoose.Schema({
    user_id: {
        type: String,
        unique: true
    },
    password_salt: String,
    password_hash: String,
    name: String
}, {
    collection: 'windows',
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    }
});
Schema.index({
    user_id: 1,
}, {
    unique: true
});
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Schema;
