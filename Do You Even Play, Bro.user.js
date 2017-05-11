// ==UserScript==
// @name         Do You Even Play, Bro?
// @namespace    https://www.steamgifts.com/user/kelnage
// @version      1.4.0
// @description  Display playing stats for SteamGifts users
// @author       kelnage
// @match        https://www.steamgifts.com/user/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      self
// @connect      api.steampowered.com
// @connect      store.steampowered.com
// @require      https://code.jquery.com/jquery-1.12.4.min.js
// @updateURL    https://raw.githubusercontent.com/kelnage/sg-play-bro/master/Do%20You%20Even%20Play%2C%20Bro.meta.js
// @downloadURL  https://raw.githubusercontent.com/kelnage/sg-play-bro/master/Do%20You%20Even%20Play%2C%20Bro.user.js
// ==/UserScript==

var CURRENT_VERSION = [1,4,0];

var SG_PAGE = "sent";
var location_details = document.location.href.match(/^https:\/\/www\.steamgifts\.com\/user\/([^\/]*)(\/[^?]*)?/);
if(location_details[2] && location_details[2].startsWith("/giveaways/won")) {
    SG_PAGE = "won";
}
var username = location_details[1];
var STEAM_URL_ID64_REGEX = /http:\/\/steamcommunity.com\/profiles\/([0-9]*)/;
var userID64 = $('[data-tooltip="Visit Steam Profile"]').attr("href").match(STEAM_URL_ID64_REGEX)[1];

var USER_PAGE = "https://www.steamgifts.com/user/";
var WINS_URL = USER_PAGE + username + "/giveaways/won/search";
var SENT_URL = USER_PAGE + username + "/search";
var PLAYTIME_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/"; // takes a steamid and API key
var ACHIEVEMENTS_URL = "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/"; // takes a steamid, appid and API key
var STEAM_API_KEY = GM_getValue("DYEPB_API_KEY");
var API_KEY_REGEXP = /[0-9A-Z]{32}/;
var WAIT_MILLIS = 500;

var PLAYTIME_CACHE_KEY = "DYEPB_PLAYTIME_CACHE",
    ACHIEVEMENT_CACHE_KEY = "DYEPB_ACHIEVEMENT_CACHE",
    WINS_CACHE_KEY = "DYEPB_WINS_CACHE_" + encodeURIComponent(username),
    SENT_CACHE_KEY = "DYEPB_SENT_CACHE_" + encodeURIComponent(username),
    LAST_CACHE_KEY = "DYEPB_LAST_CACHED_" + encodeURIComponent(username),
    USER_CACHE_VERSION_KEY = "DYEPB_USER_CACHE_VERSION_" + encodeURIComponent(username),
    USER_ID_CACHE = "DYEPB_USER_ID_CACHE",
    SUB_APPID_CACHE_KEY = "DYEPB_SUB_APPID_CACHE",
    SUB_APPID_CACHE_VERSION_KEY = "DYEPB_SUB_APPID_CACHE_VERSION";

var $percentage = $('<div class="featured__table__row__right"></div>'),
    $average_playtime = $('<div class="featured__table__row__right"></div>'),
    $total_playtime = $('<div class="featured__table__row__right"></div>'),
    $game_counts = $('<div class="featured__table__row__right"></div>'),
    $last_updated = $('<span title="" style="color: rgba(255,255,255,0.4)"></span>'),
    $progress_text = $('<span style="margin-left: 0.3em"></span>'),
    $rm_key_link = $('<a style="margin-left: 0.5em;color: rgba(255,255,255,0.6)" href="#">Delete cached API key</a>'),
    $toolbar = $('<div id="sg_dyepb_toolbar" style="color: rgba(255,255,255,0.4)" class="nav__left-container"></div>'),
    $fetch_button = $('<a class="nav__button" href="#">' + (GM_getValue(LAST_CACHE_KEY) ? 'Update Playing Info' : 'Fetch Playing Info' ) + '</a>'),
    $key_button = $('<a class="nav__button" href="#">Provide API Key</a>'),
    $button_container = $('<div class="nav__button-container"></div>'),
    $progress_container = $('<div id="progress" style="margin: 0.5em 0"><img src="https://cdnjs.cloudflare.com/ajax/libs/semantic-ui/0.16.1/images/loader-large.gif" height="10px" width="10px" /></div>');

var playtimeCaches = {},
    achievementCaches = {},
    userIdCache = {},
    winsCache = {},
    sentCache = {},
    subAppIdsCache = {},
    activeRequests = 0,
    errorCount = 0,
    run_status = "STOPPED", // can be STOPPED, PLAYTIME, SENT_GAMES, SENT_STATS, WON_GAMES, ACHIEVEMENTS
    current_username = username;

if(JSON.parse(GM_getValue(USER_CACHE_VERSION_KEY, "[0,0,0]")) >= [1,4,0]) { // Ignore caches from versions older than 1.4.0
    if(GM_getValue(PLAYTIME_CACHE_KEY)) {
        playtimeCaches = JSON.parse(GM_getValue(PLAYTIME_CACHE_KEY));
    }
    if(GM_getValue(ACHIEVEMENT_CACHE_KEY)) {
        achievementCaches = JSON.parse(GM_getValue(ACHIEVEMENT_CACHE_KEY));
    }
    if(GM_getValue(WINS_CACHE_KEY)) {
        var tempWinsCache = JSON.parse(GM_getValue(WINS_CACHE_KEY));
        if(Array.isArray(tempWinsCache)) { // reset old wins cache
            winsCache = {};
        } else {
            winsCache = tempWinsCache;
        }
    }
    if(GM_getValue(SENT_CACHE_KEY)) {
        sentCache = JSON.parse(GM_getValue(SENT_CACHE_KEY));
    }
    if(GM_getValue(USER_ID_CACHE)) {
        userIdCache = JSON.parse(GM_getValue(USER_ID_CACHE));
    }
}
if(GM_getValue(SUB_APPID_CACHE_KEY)) {
    if(JSON.parse(GM_getValue(SUB_APPID_CACHE_VERSION_KEY, "[0,0,0]")) >= [1,4,0]) { // Ignore caches from versions older than 1.4.0
        subAppIdsCache = JSON.parse(GM_getValue(SUB_APPID_CACHE_KEY));
    }
}

if(!playtimeCaches['id'+userID64]) playtimeCaches['id'+userID64] = {};
if(!achievementCaches['id'+userID64]) achievementCaches['id'+userID64] = {};
if(!userIdCache['u'+username]) userIdCache['u'+username] = userID64;

var debugCaches = function() {
    console.debug("Playtime", playtimeCaches, "Achievements", achievementCaches, "User IDs", userIdCache, "Wins", winsCache, "Sent", sentCache, "SubAppIDs", subAppIdsCache);
};
debugCaches();

var errorFn = function(response) {
    activeRequests -= 1;
    errorCount += 1;
    console.log("Error details: ", response.status, response.responseText);
};

var formatPercentage = function(x, per, precision) {
    if(isNaN(x / per)) {
        return "N/A";
    }
    return Number(x / per * 100).toPrecision(precision) + "%";
};

var formatMinutes = function(mins) {
    if(isNaN(mins)) {
        return "N/A";
    }
    if(mins < 60) {
        return mins.toPrecision(2) + " minutes";
    } else {
        var hours = mins / 60;
        if(hours < 100) {
            return hours.toPrecision(2) + " hours";
        } else if(hours < 1000) {
            return hours.toPrecision(3) + " hours";
        } else if(hours < 10000) {
            return hours.toPrecision(4) + " hours";
        } else {
            return hours.toPrecision(5) + " hours";
        }
    }
};

var getUserId = function(username, callback) {
    if(userIdCache['u'+username]) {
        callback(userIdCache['u'+username]);
    } else {
        activeRequests += 1;
        GM_xmlhttpRequest({
            "method": "GET",
            "url": USER_PAGE + username,
            "onload": function(response) {
                var id64 = $('[data-tooltip="Visit Steam Profile"]', response.responseText).attr("href").match(STEAM_URL_ID64_REGEX)[1];
                userIdCache['u'+username] = id64;
                cacheJSONValue(USER_ID_CACHE, userIdCache);
                activeRequests -= 1;
                callback(id64);
            },
            "onabort": errorFn,
            "onerror": errorFn,
            "ontimeout": errorFn
        });
    }
};

var enhanceWonRow = function($heading, minutesPlayed, achievementCounts) {
    var $playtimeSpan = $heading.find(".dyegb_playtime"), $achievementSpan = $heading.find(".dyegb_achievement");
    if(minutesPlayed) {
        if($playtimeSpan.length > 0) {
            $playtimeSpan.text(formatMinutes(minutesPlayed));
        } else {
            $heading.append('<span class="dyegb_playtime giveaway__heading__thin">' + formatMinutes(minutesPlayed) + '</span>');
        }
    }
    if(achievementCounts && achievementCounts.total > 0) {
        if($achievementSpan.length === 0) {
            $achievementSpan = $('<span class="dyegb_achievement giveaway__heading__thin">' + formatPercentage(achievementCounts.achieved, achievementCounts.total, 3) + '</span>');
            $heading.append($achievementSpan);
        }
        if(achievementCounts.achieved === 0) {
            $achievementSpan.text("0%");
        } else {
            $achievementSpan.attr('style', "font-weight: bold");
            $achievementSpan.text(formatPercentage(achievementCounts.achieved, achievementCounts.total, 3));
            $achievementSpan.attr('title', achievementCounts.achieved + '/' + achievementCounts.total + ' achievements');
            if(achievementCounts.achieved == achievementCounts.total) {
                $achievementSpan.attr('style', "font-weight: bold; color: rgb(91, 192, 222)");
            } else {
                $achievementSpan.addClass("giveaway__column--positive");
            }
        }
    }
};

var enhanceWonGames = function() {
    var $rows = $(".giveaway__row-inner-wrap");
    $rows.each(function() {
        var $this = $(this), $heading = $this.find(".giveaway__heading"),
            $ga_icon = $this.find("a.giveaway__icon:has(i.fa-steam)");
        if($ga_icon && $ga_icon.attr("href")) {
            var id = $ga_icon.attr("href").match(/http:\/\/store.steampowered.com\/([^\/]*)\/([0-9]*)\//);
            if(id[1] == "sub" || id[1] == "subs") {
                var totalMinutes = 0, totalAchievements = {achieved: 0, total: 0};
                if(subAppIdsCache['s'+id[2]]) {
                    var appids = subAppIdsCache['s'+id[2]];
                    for(var i = 0; i < appids.length; i++) {
                        if(playtimeCaches['id'+userID64]['a'+appids[i]]) {
                            totalMinutes += playtimeCaches['id'+userID64]['a'+appids[i]];
                        }
                        if(achievementCaches['id'+userID64]['a'+appids[i]]) {
                            totalAchievements.achieved += achievementCaches['id'+userID64]['a'+appids[i]].achieved;
                            totalAchievements.total += achievementCaches['id'+userID64]['a'+appids[i]].total;
                        }
                    }
                }
                enhanceWonRow($heading, totalMinutes, totalAchievements);
            }
            if(id[1] == "app" || id[1] == "apps") {
                enhanceWonRow($heading, playtimeCaches['id'+userID64]['a'+id[2]], achievementCaches['id'+userID64]['a'+id[2]]);
            }
        }
    });
};

var enhanceSentRow = function(winner, $heading, minutesPlayed, achievementCounts) {
    var $winnersTable = $heading.find(".dyegb_winners");
    if($winnersTable.length === 0) {
        $winnersTable = $('<table class="dyegb_winners"></table>');
        $heading.append($winnersTable);
    }
    var $winnerRow = $winnersTable.find("tr.user"+winner);
    if($winnerRow.length === 0) {
        $winnerRow = $('<tr class="user'+winner+'"><td>'+winner+'</td><td class="dyegb_playtime"></td><td class="dyegb_achievement"></td></tr>');
        $winnersTable.append($winnerRow);
    }
    var $playtimeCell = $winnerRow.find(".dyegb_playtime"), $achievementCell = $winnerRow.find(".dyegb_achievement");
    if(minutesPlayed) {
        $playtimeCell.text(formatMinutes(minutesPlayed));
    }
    if(achievementCounts && achievementCounts.total > 0) {
        if(achievementCounts.achieved === 0) {
            $achievementCell.text("0%");
        } else {
            $achievementCell.attr('style', "font-weight: bold");
            $achievementCell.text(formatPercentage(achievementCounts.achieved, achievementCounts.total, 3));
            $achievementCell.attr('title', achievementCounts.achieved + '/' + achievementCounts.total + ' achievements');
            if(achievementCounts.achieved == achievementCounts.total) {
                $achievementCell.attr('style', "font-weight: bold; color: rgb(91, 192, 222)");
            } else {
                $achievementCell.addClass("giveaway__column--positive");
            }
        }
    }
};

var enhanceSentGames = function() {
    var $rows = $(".giveaway__row-inner-wrap");
    $rows.each(function() {
        var $this = $(this), $heading = $this.find(".giveaway__heading"),
            $ga_icon = $this.find("a.giveaway__icon:has(i.fa-steam)"),
            gaId = "deleted";
        if($heading.find("a.giveaway__heading__name").attr("href")) {
            gaId = $heading.find("a.giveaway__heading__name").attr("href").match(/\/giveaway\/([^\/]*)\/.*/)[1];
        }
        if($ga_icon && $ga_icon.attr("href")) {
            var id = $ga_icon.attr("href").match(/http:\/\/store.steampowered.com\/([^\/]*)\/([0-9]*)\//),
                cacheId = 'a'+id[2]+'-'+gaId;
            if(sentCache[cacheId]) {
                for(var i = 0; i < sentCache[cacheId].winners.length; i++) {
                    var winner = sentCache[cacheId].winners[i],
                        winnerId = userIdCache['u'+winner];
                    if(winnerId && playtimeCaches['id'+winnerId] && achievementCaches['id'+winnerId]) {
                        if(id[1] == "sub" || id[1] == "subs") {
                            var totalMinutes = 0, totalAchievements = {achieved: 0, total: 0};
                            if(subAppIdsCache['s'+id[2]]) {
                                var appids = subAppIdsCache['s'+id[2]];
                                for(var j = 0; j < appids.length; j++) {
                                    if(playtimeCaches['id'+winnerId]['a'+appids[j]]) {
                                        totalMinutes += playtimeCaches['id'+winnerId]['a'+appids[j]];
                                    }
                                    if(achievementCaches['id'+winnerId]['a'+appids[j]]) {
                                        totalAchievements.achieved += achievementCaches['id'+winnerId]['a'+appids[j]].achieved;
                                        totalAchievements.total += achievementCaches['id'+winnerId]['a'+appids[j]].total;
                                    }
                                }
                            }
                            enhanceSentRow(winner, $heading, totalMinutes, totalAchievements);
                        }
                        if(id[1] == "app" || id[1] == "apps") {
                            enhanceSentRow(winner, $heading, playtimeCaches['id'+winnerId]['a'+id[2]], achievementCaches['id'+winnerId]['a'+id[2]]);
                        }
                    }
                }
            }
        }
    });
};

var updateWonTableStats = function() {
    var achievement_percentage_sum = 0, achievement_game_count = 0, achieved_game_count = 0,
        playtime_total = 0, playtime_game_count = 0, win_count = 0;
    $.each(winsCache, function(aid, details) {
        var appid = details.id;
        win_count += 1;
        var achievement_counts = achievementCaches['id'+userID64][aid];
        if(achievement_counts && achievement_counts.total > 0) {
            achievement_game_count += 1;
            if(achievement_counts.achieved > 0) {
                achievement_percentage_sum += achievement_counts.achieved / achievement_counts.total;
                achieved_game_count += 1;
            }
        }
        if(playtimeCaches['id'+userID64][aid]) {
            playtime_total += playtimeCaches['id'+userID64][aid];
            playtime_game_count += 1;
        }
    });
    if(achieved_game_count > 0) {
        $percentage.text(formatPercentage(achievement_percentage_sum, achieved_game_count, 3));
    } else {
        $percentage.text("N/A");
    }
    if(playtime_game_count !== win_count) {
        $average_playtime.text(formatMinutes(playtime_total / win_count) + " per win, " + formatMinutes(playtime_total / playtime_game_count) + " per played win");
    } else {
        $average_playtime.text(formatMinutes(playtime_total / win_count) + " in all wins");
    }
    $total_playtime.text(formatMinutes(playtime_total));
    $game_counts.text(formatPercentage(playtime_game_count, win_count, 3) + " (" + playtime_game_count + '/' + win_count + ') with playtime, ' +
                      formatPercentage(achieved_game_count, achievement_game_count, 3) + " (" + achieved_game_count + '/' + achievement_game_count + ') with ≥1 achievement');
};

var updateDisplayedCacheDate = function(t) {
    if(t) {
        $last_updated.text('Last retrieved: ' + t.toLocaleDateString() + (errorCount > 0 ? ", with " + errorCount + " API query errors" : ""));
        $last_updated.attr('title', t.toLocaleString());
    }
};

var displayButtons = function() {
    if(!API_KEY_REGEXP.test(STEAM_API_KEY)) {
        $button_container.show();
        $progress_container.hide();
        $key_button.show();
        $fetch_button.hide();
        $last_updated.empty();
        $last_updated.attr("title", "");
        $last_updated.show();
        $last_updated.append('<a style="color: rgba(255,255,255,0.6)" target="_blank" href="https://steamcommunity.com/dev/apikey">Click here to obtain a Steam API key</a>');
        $rm_key_link.hide();
    } else if(run_status == "STOPPED") {
        $button_container.show();
        $progress_container.hide();
        $fetch_button.show();
        $key_button.hide();
        $last_updated.empty(); // will be updated by updateDisplayedCacheDate
        $last_updated.show();
        if(GM_getValue(LAST_CACHE_KEY)) {
            $fetch_button.text("Update Playing Info");
            updateDisplayedCacheDate(new Date(GM_getValue(LAST_CACHE_KEY)));
        } else {
            $fetch_button.text("Fetch Playing Info");
        }
        $rm_key_link.show();
    } else {
        $button_container.hide();
        $progress_container.show();
        if(run_status == "PLAYTIMES") {
            $progress_text.text("Retriving " + current_username + "'s logged playing times");
        } else if(run_status == "SENT_GAMES") {
            $progress_text.text("Retriving " + current_username + "'s sent games");
        } else if(run_status == "WON_GAMES") {
            $progress_text.text("Retriving " + current_username + "'s won games");
        } else if(run_status == "ACHIEVEMENTS") {
            $progress_text.text("Retriving " + current_username + "'s achievement progress (" + activeRequests + " games left to check)");
        } else if(run_status == "SENT_STATS") {
            $progress_text.text("Retriving GA winner's game stats (" + activeRequests + " requests left)");
        }
        $last_updated.hide();
        $rm_key_link.hide();
    }
};

var updatePage = function(update_time) {
    if(SG_PAGE == "won") {
        console.log("Updating won data");
        enhanceWonGames();
        updateWonTableStats();
    }
    if(SG_PAGE == "sent") {
        enhanceSentGames();
        // updateSentTableStats();
    }
    displayButtons();
    updateDisplayedCacheDate(update_time);
};

var extractSubGames = function(cache, sub, winners, page) {
    subAppIdsCache['s'+sub] = [];
    $(".tab_item", page).each(function(i, e) {
        var $this = $(e),
            appId = $this.attr("data-ds-appid"),
            name = $this.find(".tab_item_name").text(),
            $link = $this.find(".tab_item_overlay");
        if($link.attr("href") && !cache['a'+appId]) {
            var type = $link.attr("href").match(/http:\/\/store.steampowered.com\/([^\/]*)\/[0-9]*\//);
            cache['a'+appId] = {"id": appId, "winners": winners};
        }
        subAppIdsCache['s'+sub].push(appId);
    });
};

var extractGames = function(cache, gaKeyId) {
    return function(page) {
        var extractCount = 0;
        $(".giveaway__row-inner-wrap", page)
            .filter(function(i) {
                return $(this).find("div.giveaway__column--positive").length == 1;
            })
            .each(function(i, e) {
                var $ga_icon = $(e).find("a.giveaway__icon:has(i.fa-steam)");
                if($ga_icon.length === 1 && $ga_icon.attr("href")) {
                    var url = $ga_icon.attr("href"),
                        id = url.match(/http:\/\/store.steampowered.com\/([^\/]*)\/([0-9]*)\//),
                        gaId = "deleted";
                    if($(e).find("a.giveaway__heading__name").attr("href")) {
                        gaId = $(e).find("a.giveaway__heading__name").attr("href").match(/\/giveaway\/([^\/]*)\/.*/)[1];
                    }
                    var winners = $(this).find("div.giveaway__column--positive a").map(function() {
                            return $(this).attr("href").match(/([^\/]*)$/)[1];
                        }).get();
                    if((id[1] == "sub" || id[1] == "subs") && !subAppIdsCache['s'+id[2]]) { // only fetch appids for uncached-subs - do subs ever change? Probably...
                        activeRequests += 1;
                        GM_xmlhttpRequest({
                            "method": "GET",
                            "url": url,
                            "onload": function(response) {
                                if(response.finalUrl === url) { // if not, probably got redirected to Steam homepage
                                    extractSubGames(cache, id[2]+(gaKeyId?"-"+gaId:""), winners, response.responseText);
                                } else {
                                    console.log("Could not get details for sub " + id[2]);
                                }
                                activeRequests -= 1;
                            },
                            "onabort": errorFn,
                            "onerror": errorFn,
                            "ontimeout": errorFn
                        });
                        extractCount += 1;
                    } else if((id[1] == "app" || id[1] == "apps") && !cache['a'+id[2]]) {
                        cache['a'+id[2]+(gaKeyId?"-"+gaId:"")] = {"id": id[2], "winners": winners};
                        extractCount += 1;
                    }
                }
            });
        return extractCount;
    };
};

var fetchGames = function(url, page, extractFn, callback) {
    activeRequests += 1;
    GM_xmlhttpRequest({
        "method": "GET",
        "url": url + "?page=" + page,
        "onload": function(response) {
            var count = extractFn(response.responseText);
            // stop fetching pages if no new games found on current page
            if($("div.pagination__navigation > a > span:contains('Next')", response.responseText).length === 1 && count > 0) {
                setTimeout(function() {
                    fetchGames(url, page + 1, extractFn, callback);
                }, WAIT_MILLIS);
                activeRequests -= 1;
            } else {
                activeRequests -= 1;
                callback();
            }
        },
        "onabort": errorFn,
        "onerror": errorFn,
        "ontimeout": errorFn
    });
};

var fetchGamePlaytimes = function(steamID64, callback) {
    activeRequests += 1;
    GM_xmlhttpRequest({
        "method": "GET",
        "url": PLAYTIME_URL + "?steamid=" + steamID64 + "&key=" + STEAM_API_KEY,
        "onload": function(response) {
            var data;
            try {
                 data = JSON.parse(response.responseText);
            } catch(err) {
                errorFn({"status": response.status, "responseText": response.responseText});
            }
            if(data) {
                var games = data.response.games;
                if(!playtimeCaches['id'+steamID64]) {
                    playtimeCaches['id'+steamID64] = {};
                }
                if(games) {
                    for(var i = 0; i < games.length; i++) {
                        playtimeCaches['id'+steamID64]["a"+games[i].appid] = games[i].playtime_forever;
                    }
                }
                activeRequests -= 1;
                callback();
            }
        },
        "onabort": errorFn,
        "onerror": errorFn,
        "ontimeout": errorFn
    });
};

var fetchAchievementStatsFn = function(appid, steamID64) {
    return function() {
        GM_xmlhttpRequest({
            "method": "GET",
            "url": ACHIEVEMENTS_URL + "?appid=" + appid + "&steamid=" + steamID64 + "&key=" + STEAM_API_KEY,
            "onload": function(response) {
                var data;
                try {
                    data = JSON.parse(response.responseText);
                } catch(err) {
                    errorFn({"status": response.status, "responseText": response.responseText});
                }
                if(data) {
                    if(!achievementCaches['id'+steamID64]) {
                        achievementCaches['id'+steamID64] = {};
                    }
                    achievements = data.playerstats.achievements;
                    if(achievements) {
                        var achieved = achievements.filter(function(achievement) { return achievement.achieved == 1; }).length;
                        var total = achievements.length;
                        achievementCaches['id'+steamID64]["a"+appid] = {"achieved": achieved, "total": total};
                    } else {
                        achievementCaches['id'+steamID64]["a"+appid] = {"achieved": 0, "total": 0};
                    }
                    activeRequests -= 1;
                }
            },
            "onabort": errorFn,
            "onerror": errorFn,
            "ontimeout": errorFn
        });
    };
};

var cacheJSONValue = function(key, value) {
    GM_setValue(key, JSON.stringify(value));
    var updateTime = new Date();
    GM_setValue(LAST_CACHE_KEY, updateTime.getTime());
    updatePage(updateTime);
};

(function() {
    'use strict';

    var $featured_table = $(".featured__table"),
        $featured_table_col1 = $featured_table.children(":first-child"),
        $featured_table_col2 = $featured_table.children(":last-child");

    var $left_row_1 = $('<div class="featured__table__row"></div>'),
        $left_row_2 = $('<div class="featured__table__row"></div>'),
        $right_row_1 = $('<div class="featured__table__row"></div>'),
        $right_row_2 = $('<div class="featured__table__row"></div>');
    $toolbar.append($button_container);
    $button_container.append($key_button);
    $button_container.append($fetch_button);
    $toolbar.append($progress_container);
    $progress_container.append($progress_text);
    $toolbar.append($last_updated);
    $toolbar.append($rm_key_link);
    $left_row_1.append('<div class="featured__table__row__left">Average Playtime</div>');
    $left_row_1.append($average_playtime);
    $left_row_2.append('<div class="featured__table__row__left">Total Playtime</div>');
    $left_row_2.append($total_playtime);
    $right_row_1.append('<div class="featured__table__row__left">Average Achievement Percentage</div>');
    $right_row_1.append($percentage);
    $right_row_2.append('<div class="featured__table__row__left">Win Counts</div>');
    $right_row_2.append($game_counts);
    $featured_table_col1.append($left_row_1);
    $featured_table_col1.append($left_row_2);
    $featured_table_col2.append($right_row_1);
    $featured_table_col2.append($right_row_2);
    $featured_table.after($toolbar);

    updatePage(GM_getValue(LAST_CACHE_KEY) ? new Date(GM_getValue(LAST_CACHE_KEY)) : null);

    $key_button.click(function(e) {
        e.preventDefault();
        STEAM_API_KEY = prompt('Please provide your Steam API key');
        while(STEAM_API_KEY !== "" && STEAM_API_KEY !== null && !API_KEY_REGEXP.test(STEAM_API_KEY)) {
            STEAM_API_KEY = prompt('Please provide your valid Steam API key');
        }
        if(API_KEY_REGEXP.test(STEAM_API_KEY)) {
            GM_setValue("DYEPB_API_KEY", STEAM_API_KEY);
            displayButtons();
        }
    });

    $rm_key_link.click(function(e) {
        e.preventDefault();
        GM_deleteValue("DYEPB_API_KEY");
        STEAM_API_KEY = "";
        displayButtons();
    });

    $fetch_button.click(function(e) {
        e.preventDefault();
        activeRequests = 0;
        errorCount = 0;
        if(SG_PAGE == "sent") {
            run_status = "SENT_GAMES";
            displayButtons();
            fetchGames(SENT_URL, 1, extractGames(sentCache, true), function() {
                var intervalId = setInterval(function() {
                    if(activeRequests === 0) {
                        clearInterval(intervalId);
                        var i = 0;
                        run_status = "SENT_STATS";
                        $.each(sentCache, function(id, details) {
                            $.each(details.winners, function(index, otherUser) {
                                setTimeout(function() {
                                    getUserId(otherUser, function(id64) {
                                        fetchGamePlaytimes(id64, function() {
                                            activeRequests += 1;
                                            setTimeout(fetchAchievementStatsFn(details.id, id64), i * 50);
                                            i += 1;
                                        });
                                    });
                                }, 100);
                            });
                        });
                        intervalId = setInterval(function() {
                            if(activeRequests === 0) {
                                clearInterval(intervalId);
                                run_status = "STOPPED";
                                cacheJSONValue(ACHIEVEMENT_CACHE_KEY, achievementCaches);
                                cacheJSONValue(PLAYTIME_CACHE_KEY, playtimeCaches);
                                cacheJSONValue(SENT_CACHE_KEY, sentCache);
                                cacheJSONValue(USER_ID_CACHE, userIdCache);
                                cacheJSONValue(SUB_APPID_CACHE_KEY, subAppIdsCache);
                                GM_setValue(SUB_APPID_CACHE_VERSION_KEY, JSON.stringify(CURRENT_VERSION));
                                GM_setValue(USER_CACHE_VERSION_KEY, JSON.stringify(CURRENT_VERSION));
                                console.log("Errors during API queries:", errorCount);
                                debugCaches();
                            } else {
                                displayButtons();
                                console.log("Active achievement requests:", activeRequests);
                            }
                        }, 500);
                    } else {
                        displayButtons();
                        console.log("Active game requests:", activeRequests);
                    }
                }, 250);
            });
        }
        if(SG_PAGE == "won") {
            current_username = username;
            run_status = "PLAYTIMES";
            displayButtons();
            fetchGamePlaytimes(userID64, function() {
                run_status = "WON_GAMES";
                cacheJSONValue(PLAYTIME_CACHE_KEY, playtimeCaches);
                fetchGames(WINS_URL, 1, extractGames(winsCache), function() {
                    var intervalId = setInterval(function() {
                        if(activeRequests === 0) {
                            clearInterval(intervalId);
                            run_status = "ACHIEVEMENTS";
                            cacheJSONValue(WINS_CACHE_KEY, winsCache);
                            cacheJSONValue(SUB_APPID_CACHE_KEY, subAppIdsCache);
                            GM_setValue(USER_CACHE_VERSION_KEY, JSON.stringify(CURRENT_VERSION));
                            GM_setValue(SUB_APPID_CACHE_VERSION_KEY, JSON.stringify(CURRENT_VERSION));
                            var i = 0;
                            $.each(winsCache, function(id, details) {
                                activeRequests += 1;
                                // increment delay to try to prevent overloading of Steam API
                                setTimeout(fetchAchievementStatsFn(details.id, userID64), i * 50);
                                i += 1;
                            });
                            intervalId = setInterval(function() {
                                if(activeRequests === 0) {
                                    clearInterval(intervalId);
                                    run_status = "STOPPED";
                                    cacheJSONValue(ACHIEVEMENT_CACHE_KEY, achievementCaches);
                                    GM_setValue(USER_CACHE_VERSION_KEY, JSON.stringify(CURRENT_VERSION));
                                    console.log("Errors during API queries:", errorCount);
                                    debugCaches();
                                } else {
                                    displayButtons();
                                    console.log("Active achievement requests:", activeRequests);
                                }
                            }, 500);
                        } else {
                            displayButtons();
                        }
                    }, 250);
                });
            });
        }
    });
})();
