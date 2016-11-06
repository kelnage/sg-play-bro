// ==UserScript==
// @name         Do You Even Play, Bro?
// @namespace    https://www.steamgifts.com/user/kelnage
// @version      1.0.1
// @description  Display playing stats for SteamGifts users
// @author       kelnage
// @match        https://www.steamgifts.com/user/*/giveaways/won*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      self
// @connect      api.steampowered.com
// @require      http://ajax.googleapis.com/ajax/libs/jquery/1.3.2/jquery.min.js
// @require      http://courses.ischool.berkeley.edu/i290-4/f09/resources/gm_jq_xhr.js
// @updateURL    https://raw.githubusercontent.com/kelnage/sg-play-bro/master/Do%20You%20Even%20Play%2C%20Bro.meta.js
// @downloadURL  https://raw.githubusercontent.com/kelnage/sg-play-bro/master/Do%20You%20Even%20Play%2C%20Bro.user.js
// ==/UserScript==

var username = $(".featured__heading__medium").text();
var userID64 = $(".sidebar__shortcut-inner-wrap").children(":last-child").attr("href").match(/http:\/\/steamcommunity.com\/profiles\/([0-9]*)/)[1];

var WINS_URL = "https://www.steamgifts.com/user/" + username + "/giveaways/won/search";
var PLAYTIME_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/"; // takes a steamid and API key
var ACHIEVEMENTS_URL = "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/"; // takes a steamid, appid and API key
var STEAM_API_KEY = GM_getValue("DYEPB_API_KEY");
var API_KEY_REGEXP = /[0-9A-Z]{32}/;
var WAIT_MILLIS = 500;

var PLAYTIME_CACHE_KEY = "DYEPB_PLAYTIME_CACHE_" + encodeURIComponent(username),
    ACHIEVEMENT_CACHE_KEY = "DYEPB_ACHIEVEMENT_CACHE_" + encodeURIComponent(username),
    WINS_CACHE_KEY = "DYEPB_WINS_CACHE_" + encodeURIComponent(username),
    LAST_CACHE_KEY = "DYEPB_LAST_CACHED_" + encodeURIComponent(username);

var $percentage = $('<div class="featured__table__row__right"></div>'),
    $average_playtime = $('<div class="featured__table__row__right"></div>'),
    $total_playtime = $('<div class="featured__table__row__right"></div>'),
    $game_counts = $('<div class="featured__table__row__right"></div>'),
    $last_updated = $('<span title="" style="color: rgba(255,255,255,0.4)"></span>');

var playtimeCache = {},
    achievementCache = {},
    winsCache = [];

if(GM_getValue(PLAYTIME_CACHE_KEY)) {
    playtimeCache = JSON.parse(GM_getValue(PLAYTIME_CACHE_KEY));
}
if(GM_getValue(ACHIEVEMENT_CACHE_KEY)) {
    achievementCache = JSON.parse(GM_getValue(ACHIEVEMENT_CACHE_KEY));
}
if(GM_getValue(WINS_CACHE_KEY)) {
    winsCache = JSON.parse(GM_getValue(WINS_CACHE_KEY));
}

var formatMinutes = function(mins) {
    if(mins < 60) {
        return mins.toPrecision(2) + " minutes";
    } else {
        var hours = mins / 60;
        if(hours < 24) {
            return hours.toPrecision(2) + " hours";
        } else {
            var days = hours / 24;
            if(days < 100) {
                return days.toPrecision(2) + " days";
            } else {
                var years = days / 365;
                return years.toPrecision(2);
            }
        }
    }
};

var enhanceWonGames = function() {
    var $rows = $(".giveaway__row-inner-wrap");
    $rows.each(function() {
        var $this = $(this), $heading = $this.find(".giveaway__heading");
        var id = $this.find("a.giveaway__icon").attr("href").match(/http:\/\/store.steampowered.com\/([^\/]*)\/([0-9]*)\//);
        if(id) {
            var $playtimeSpan = $heading.find(".dyegb_playtime"), $achievementSpan = $heading.find(".dyegb_achievement");
            if(playtimeCache['a'+id[2]]) {
                if($playtimeSpan.length > 0) {
                    $playtimeSpan.text(formatMinutes(playtimeCache['a'+id[2]]));
                } else {
                    $heading.append('<span class="dyegb_playtime giveaway__heading__thin">' + formatMinutes(playtimeCache['a'+id[2]]) + '</span>');
                }
            }
            if(achievementCache['a'+id[2]] && achievementCache['a'+id[2]].total > 0) {
                var counts = achievementCache['a'+id[2]];
                if($achievementSpan.length > 0) {
                    $achievementSpan.text(Number(counts.achieved / counts.total * 100).toPrecision(3) + "%");
                    $achievementSpan.attr('title', counts.achieved + '/' + counts.total + ' achievements');
                } else {
                    $heading.append('<span class="dyegb_achievement giveaway__heading__thin" title="' + counts.achieved + '/' + counts.total + ' achievements">' +
                                    Number(counts.achieved / counts.total * 100).toPrecision(3) + '%</div>');
                }
            }
        }
    });
};

var updateTableStats = function() {
    var achievement_percentage_sum = 0, achievement_game_count = 0, achieved_game_count = 0, playtime_total = 0, playtime_game_count = 0;
    if(winsCache.length > 0) {
        for(var i = 0; i < winsCache.length; i++) {
            var id = 'a'+winsCache[i].appid,
                achievement_counts = achievementCache[id];
            if(achievement_counts && achievement_counts.total > 0) {
                achievement_percentage_sum += (achievement_counts.achieved / achievement_counts.total) * 100;
                achievement_game_count += 1;
                if(achievement_counts.achieved > 0) {
                    achieved_game_count += 1;
                }
            }
            if(playtimeCache[id]) {
                playtime_total += playtimeCache[id];
                playtime_game_count += 1;
            }
        }
        if(achievement_game_count > 0) {
            $percentage.text(Number(achievement_percentage_sum / achievement_game_count).toPrecision(3) + "%");
        } else {
            $percentage.text("N/A");
        }
        $average_playtime.text(formatMinutes(playtime_total / winsCache.length));
        $total_playtime.text(formatMinutes(playtime_total));
        $game_counts.text(playtime_game_count + '/' + winsCache.length + ' with playtime, ' + achieved_game_count + '/' + achievement_game_count + ' with at least one achievement');
    }
};

var updateDisplayedCacheDate = function(t) {
    if(t) {
        $last_updated.text('Last retrieved: ' + t.toLocaleDateString());
        $last_updated.attr('title', t.toLocaleString());
    }
};

var updatePage = function(update_time) {
    enhanceWonGames();
    updateTableStats();
    updateDisplayedCacheDate(update_time);
};

var extractWon = function(page) {
    return $(".giveaway__row-inner-wrap", page)
        .filter(function(i) {
            return $(this).find("div.giveaway__column--positive").length == 1;
        })
        .map(function() {
            var ga_icon = $(this).find("a.giveaway__icon");
            if(ga_icon.length === 1 && ga_icon.attr("href")) {
                var id = $(this).find("a.giveaway__icon").attr("href").match(/http:\/\/store.steampowered.com\/([^\/]*)\/([0-9]*)\//);
                return {"name":  $(this).find("a.giveaway__heading__name").text(), "appid": id[2], "type": id[1]};
            } else {
                return {"name":  $(this).find("a.giveaway__heading__name").text(), "appid": null, "type": null};
            }
        })
        .get(); // turns the result into a JS array
};

var fetchWon = function(wonGames, page, callback) {
    $.get(WINS_URL, {"page": page}, function(data) {
        // console.log(data);
        var wins = extractWon(data);
        wonGames = wonGames.concat(wins.filter(function(win) { return win.type == "app" || win.type == "apps"; }));
        if($("div.pagination__navigation > a > span:contains('Next')", data).length === 1) {
            setTimeout(function() {
                fetchWon(wonGames, page + 1, callback);
            }, WAIT_MILLIS);
        } else {
            callback(wonGames);
        }
    });
};

var fetchGamePlaytimes = function(gamePlaytimes, steamID64, callback) {
    $.getJSON(PLAYTIME_URL, {"steamid": steamID64, "key": STEAM_API_KEY}, function(data) {
        // console.log(data);
        var games = data.response.games;
        if(games) {
            for(var i = 0; i < games.length; i++) {
                gamePlaytimes["a"+games[i].appid] = games[i].playtime_forever;
            }
        }
        callback();
    });
};

var fetchAchievementStats = function(gameAchievements, appid, steamID64, callback) {
    $.getJSON(ACHIEVEMENTS_URL, {"appid": appid, "steamid": steamID64, "key": STEAM_API_KEY}, function(data) {
        // console.log(data);
        var achievements = data.playerstats.achievements;
        if(achievements) {
            var achieved = achievements.filter(function(achievement) { return achievement.achieved == 1; }).length;
            var total = achievements.length;
            gameAchievements["a"+appid] = {"achieved": achieved, "total": total};
        } else {
            gameAchievements["a"+appid] = {"achieved": 0, "total": 0};
        }
        callback(gameAchievements["a"+appid]);
    });
};

(function() {
    'use strict';

    var $featured_table = $(".featured__table"),
        $featured_table_col1 = $featured_table.children(":first-child"),
        $featured_table_col2 = $featured_table.children(":last-child");
    var wonGames = [], gamePlaytimes = {}, gameAchievements = {};

    var $toolbar = $('<div id="sg_dyepb_toolbar" class="nav__left-container"></div>'),
        $fetch_button = $('<a class="nav__button" href="#">' + (GM_getValue(LAST_CACHE_KEY) ? 'Update Playing Info' : 'Fetch Playing Info' ) + '</a>'),
        $key_button = $('<a class="nav__button" href="#">Provide API Key</a>'),
        $button_container = $('<div class="nav__button-container"></div>'),
        $left_row_1 = $('<div class="featured__table__row"></div>'),
        $left_row_2 = $('<div class="featured__table__row"></div>'),
        $right_row_1 = $('<div class="featured__table__row"></div>'),
        $right_row_2 = $('<div class="featured__table__row"></div>');
    if(!API_KEY_REGEXP.test(STEAM_API_KEY)) {
        $button_container.append($key_button);
        $last_updated.append('<a style="color: rgba(255,255,255,0.6)" target="_blank" href="https://steamcommunity.com/dev/apikey">Click here to obtain a Steam API key</a>');
    } else {
        $button_container.append($fetch_button);
    }
    $left_row_1.append('<div class="featured__table__row__left">Average Playtime</div>');
    $left_row_1.append($average_playtime);
    $left_row_2.append('<div class="featured__table__row__left">Total Playtime</div>');
    $left_row_2.append($total_playtime);
    $right_row_1.append('<div class="featured__table__row__left">Average Achievement Percentage</div>');
    $right_row_1.append($percentage);
    $right_row_2.append('<div class="featured__table__row__left">Win Counts</div>');
    $right_row_2.append($game_counts);
    $toolbar.append($button_container);
    $toolbar.append($last_updated);
    $featured_table_col1.append($left_row_1);
    $featured_table_col1.append($left_row_2);
    $featured_table_col2.append($right_row_1);
    $featured_table_col2.append($right_row_2);
    $featured_table.after($toolbar);

    updatePage(GM_getValue(LAST_CACHE_KEY) ? new Date(GM_getValue(LAST_CACHE_KEY)) : null);

    $key_button.click(function(e) {
        e.preventDefault();
        STEAM_API_KEY = prompt('Please provide your Steam API key');
        while(STEAM_API_KEY !== "" && !API_KEY_REGEXP.test(STEAM_API_KEY)) {
            STEAM_API_KEY = prompt('Please provide your valid Steam API key');
        }
        if(API_KEY_REGEXP.test(STEAM_API_KEY)) {
            GM_setValue("DYEPB_API_KEY", STEAM_API_KEY);
            $button_container.empty();
            $button_container.append($fetch_button);
            $last_updated.empty();
        }
    });

    $fetch_button.click(function(e) {
        e.preventDefault();
        fetchGamePlaytimes(gamePlaytimes, userID64, function() {
            playtimeCache = gamePlaytimes;
            GM_setValue(PLAYTIME_CACHE_KEY, JSON.stringify(gamePlaytimes));
            var updateTime = new Date();
            GM_setValue(LAST_CACHE_KEY, updateTime.getTime());
            updatePage(updateTime);
            fetchWon(wonGames, 1, function(wonGames) {
                winsCache = wonGames;
                GM_setValue(WINS_CACHE_KEY, JSON.stringify(wonGames));
                var updateTime = new Date();
                GM_setValue(LAST_CACHE_KEY, updateTime.getTime());
                updatePage(updateTime);
                for(var i = 0; i < wonGames.length; i++) {
                    fetchAchievementStats(gameAchievements, wonGames[i].appid, userID64, function(achievement_counts) {
                        achievementCache = gameAchievements;
                        GM_setValue(ACHIEVEMENT_CACHE_KEY, JSON.stringify(gameAchievements));
                        var updateTime = new Date();
                        GM_setValue(LAST_CACHE_KEY, updateTime.getTime());
                        updatePage(updateTime);
                    });
                }
            });
        });
        $fetch_button.text("Update Playing Info");
    });
})();
