"use strict";
/**
 * ルーティング
 *
 * @ignore
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const languageController = require("../controllers/language");
// import * as otherController from '../controllers/other';
const reserveController = require("../controllers/reserve");
const router = express.Router();
// 言語
router.get('/language/update/:locale', languageController.update);
router.get('/reserve/getSeatProperties', reserveController.getSeatProperties);
router.get('/reserve/:performanceId/unavailableSeatCodes', reserveController.getUnavailableSeatCodes);
exports.default = router;
