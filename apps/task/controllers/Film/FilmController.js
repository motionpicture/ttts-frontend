"use strict";
const BaseController_1 = require("../BaseController");
const ttts_domain_1 = require("@motionpicture/ttts-domain");
const conf = require("config");
const mongoose = require("mongoose");
const request = require("request");
const fs = require("fs-extra");
let MONGOLAB_URI = conf.get('mongolab_uri');
class FilmController extends BaseController_1.default {
    createTicketTypeGroupsFromJson() {
        mongoose.connect(MONGOLAB_URI, {});
        fs.readFile(`${process.cwd()}/data/${process.env.NODE_ENV}/ticketTypeGroups.json`, 'utf8', (err, data) => {
            if (err)
                throw err;
            let groups = JSON.parse(data);
            this.logger.info('removing all groups...');
            ttts_domain_1.Models.TicketTypeGroup.remove({}, (err) => {
                if (err)
                    throw err;
                this.logger.debug('creating groups...');
                ttts_domain_1.Models.TicketTypeGroup.create(groups, (err) => {
                    this.logger.info('groups created.', err);
                    mongoose.disconnect();
                    process.exit(0);
                });
            });
        });
    }
    createFromJson() {
        mongoose.connect(MONGOLAB_URI, {});
        fs.readFile(`${process.cwd()}/data/${process.env.NODE_ENV}/films.json`, 'utf8', (err, data) => {
            if (err)
                throw err;
            let films = JSON.parse(data);
            let promises = films.map((film) => {
                return new Promise((resolve, reject) => {
                    this.logger.debug('updating film...');
                    ttts_domain_1.Models.Film.findOneAndUpdate({
                        _id: film._id
                    }, film, {
                        new: true,
                        upsert: true
                    }, (err) => {
                        this.logger.debug('film updated', err);
                        (err) ? reject(err) : resolve();
                    });
                });
            });
            Promise.all(promises).then(() => {
                this.logger.info('promised.');
                mongoose.disconnect();
                process.exit(0);
            }, (err) => {
                this.logger.error('promised.', err);
                mongoose.disconnect();
                process.exit(0);
            });
        });
    }
    /**
     * 作品画像を取得する
     */
    getImages() {
        mongoose.connect(MONGOLAB_URI, {});
        ttts_domain_1.Models.Film.find({}, 'name', { sort: { _id: 1 } }, (err, films) => {
            if (err)
                throw err;
            let next = (film) => {
                let options = {
                    url: `https://api.cognitive.microsoft.com/bing/v5.0/images/search?q=${encodeURIComponent(film.get('name.ja'))}`,
                    json: true,
                    headers: {
                        'Ocp-Apim-Subscription-Key': '3bca568e7b684e218eb2a11d0cdce9c0'
                    }
                };
                // let options = {
                //     url: `https://api.photozou.jp/rest/search_public.json?limit=1&keyword=${encodeURIComponent(film.get('name').ja)}`,
                //     json: true
                // };
                console.log('searching...', film.get('name').ja);
                request.get(options, (error, response, body) => {
                    if (!error && response.statusCode == 200) {
                        if (body.value.length > 0) {
                            let image = body.value[0].thumbnailUrl;
                            console.log('thumbnailUrl:', image);
                            request.get({ url: image, encoding: null }, (error, response, body) => {
                                this.logger.debug('image saved.', error);
                                if (!error && response.statusCode === 200) {
                                    fs.writeFileSync(`${__dirname}/../../../../public/images/film/${film.get('_id').toString()}.jpg`, body, 'binary');
                                }
                                if (i === films.length - 1) {
                                    this.logger.debug('success!');
                                    mongoose.disconnect();
                                    process.exit(0);
                                }
                                else {
                                    i++;
                                    next(films[i]);
                                }
                            });
                        }
                        else {
                            i++;
                            next(films[i]);
                        }
                    }
                    else {
                        if (i === films.length - 1) {
                            this.logger.debug('success!');
                            mongoose.disconnect();
                            process.exit(0);
                        }
                        else {
                            i++;
                            next(films[i]);
                        }
                    }
                });
            };
            let i = 0;
            next(films[i]);
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = FilmController;
