// ==UserScript==
// @name         Do You Even Play, Bro?
// @namespace    https://www.steamgifts.com/user/kelnage
// @version      1.3.8
// @description  Display playing stats for SteamGifts users
// @author       kelnage
// @match        https://www.steamgifts.com/user/*/giveaways/won*
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

var CURRENT_VERSION = [1,3,8];

var username = $(".featured__heading__medium").text();
var userID64 = $('[data-tooltip="Visit Steam Profile"]').attr("href").match(/http:\/\/steamcommunity.com\/profiles\/([0-9]*)/)[1];

var WINS_URL = "https://www.steamgifts.com/user/" + username + "/giveaways/won/search";
var PLAYTIME_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/"; // takes a steamid and API key
var ACHIEVEMENTS_URL = "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/"; // takes a steamid, appid and API key
var STEAM_API_KEY = GM_getValue("DYEPB_API_KEY");
var API_KEY_REGEXP = /[0-9A-Z]{32}/;
var WAIT_MILLIS = 500;

var PLAYTIME_CACHE_KEY = "DYEPB_PLAYTIME_CACHE_" + encodeURIComponent(username),
    ACHIEVEMENT_CACHE_KEY = "DYEPB_ACHIEVEMENT_CACHE_" + encodeURIComponent(username),
    WINS_CACHE_KEY = "DYEPB_WINS_CACHE_" + encodeURIComponent(username),
    LAST_CACHE_KEY = "DYEPB_LAST_CACHED_" + encodeURIComponent(username),
    USER_CACHE_VERSION_KEY = "DYEPB_USER_CACHE_VERSION_" + encodeURIComponent(username),
    SUB_APPID_CACHE_KEY = "DYEPB_SUB_APPID_CACHE",
    SUB_APPID_CACHE_VERSION_KEY = "DYEPB_SUB_APPID_CACHE_VERSION";

var $percentage = $('<div class="featured__table__row__right"></div>'),
    $average_total_playtime = $('<div class="featured__table__row__right"></div>'),
    $playtime_any_counts = $('<div class="featured__table__row__right" style="text-align: right"></div>'),
    $playtime_5_10_counts = $('<div class="featured__table__row__right" style="text-align: right"></div>'),
    $achievement_any_counts = $('<div class="featured__table__row__right" style="text-align: right"></div>'),
    $achievement_25_counts = $('<div class="featured__table__row__right" style="text-align: right"></div>'),
    $achievement_50_counts = $('<div class="featured__table__row__right" style="text-align: right"></div>'),
    $achievement_75_counts = $('<div class="featured__table__row__right" style="text-align: right"></div>'),
    $achievement_100_counts = $('<div class="featured__table__row__right" style="text-align: right"></div>'),
    $last_updated = $('<span title="" style="color: rgba(255,255,255,0.4)"></span>'),
    $progress_text = $('<span style="margin-left: 0.3em"></span>'),
    $rm_key_link = $('<a style="margin-left: 0.5em;color: rgba(255,255,255,0.6)" href="#">Delete cached API key</a>'),
    $toolbar = $('<div id="sg_dyepb_toolbar" style="color: rgba(255,255,255,0.4)" class="nav__left-container"></div>'),
    $fetch_button = $('<a class="nav__button" href="#">' + (GM_getValue(LAST_CACHE_KEY) ? 'Update Playing Info' : 'Fetch Playing Info' ) + '</a>'),
    $key_button = $('<a class="nav__button" href="#">Provide API Key</a>'),
    $button_container = $('<div class="nav__button-container"></div>'),
    $progress_container = $('<div id="progress" style="margin: 0.5em 0"><img src="https://cdnjs.cloudflare.com/ajax/libs/semantic-ui/0.16.1/images/loader-large.gif" height="10px" width="10px" /></div>');

var playtimeCache = {},
    achievementCache = {},
    winsCache = {},
    subAppIdsCache = {},
    activeRequests = 0,
    errorCount = 0,
    run_status = "STOPPED"; // can be STOPPED, PLAYTIME, WON_GAMES, ACHIEVEMENTS

if(JSON.parse(GM_getValue(USER_CACHE_VERSION_KEY, "[0,0,0]")) > [1,3,2]) { // Ignore caches from versions older than 1.3.3
    if(GM_getValue(PLAYTIME_CACHE_KEY)) {
        playtimeCache = JSON.parse(GM_getValue(PLAYTIME_CACHE_KEY));
    }
    if(GM_getValue(ACHIEVEMENT_CACHE_KEY)) {
        achievementCache = JSON.parse(GM_getValue(ACHIEVEMENT_CACHE_KEY));
    }
    if(GM_getValue(WINS_CACHE_KEY)) {
        var tempWinsCache = JSON.parse(GM_getValue(WINS_CACHE_KEY));
        if(Array.isArray(tempWinsCache)) { // convert old array into an object
            for(var i = 0; i < tempWinsCache.length; i++) {
                winsCache['a'+tempWinsCache[i].appid] = tempWinsCache[i].appid;
            }
        } else {
            winsCache = tempWinsCache;
        }
    }
}
if(GM_getValue(SUB_APPID_CACHE_KEY)) {
    if(JSON.parse(GM_getValue(SUB_APPID_CACHE_VERSION_KEY, "[0,0,0]")) > [1,3,2]) { // Ignore caches from versions older than 1.3.3
        subAppIdsCache = JSON.parse(GM_getValue(SUB_APPID_CACHE_KEY));
    }
}

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

var enhanceRow = function($heading, minutesPlayed, achievementCounts) {
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
                        if(playtimeCache['a'+appids[i]]) {
                            totalMinutes += playtimeCache['a'+appids[i]];
                        }
                        if(achievementCache['a'+appids[i]]) {
                            totalAchievements.achieved += achievementCache['a'+appids[i]].achieved;
                            totalAchievements.total += achievementCache['a'+appids[i]].total;
                        }
                    }
                }
                enhanceRow($heading, totalMinutes, totalAchievements);
            }
            if(id[1] == "app" || id[1] == "apps") {
                enhanceRow($heading, playtimeCache['a'+id[2]], achievementCache['a'+id[2]]);
            }
        }
    });
};

var updateTableStats = function() {
    var achievement_percentage_sum = 0, achievement_game_count = 0, achieved_game_count = 0,
        achieved_game_count_25 = 0, achieved_game_count_50 = 0, achieved_game_count_75 = 0, achieved_game_count_100 = 0,
        playtime_total = 0, playtime_game_count = 0, playtime_game_count_5h = 0, playtime_game_count_10h = 0,
        win_count = 0, achievement_playtime_total = 0, achievement_playtime_count = 0;
    $.each(winsCache, function(aid, appid) {
        var achievement_counts = achievementCache[aid];
        if(achievement_counts && achievement_counts.total > 0) {
            achievement_game_count += 1;
            if(achievement_counts.achieved > 0) {
                achievement_percentage_sum += achievement_counts.achieved / achievement_counts.total;
                achieved_game_count += 1;
                if(achievement_counts.achieved >= (achievement_counts.total / 4)) {
                    achieved_game_count_25 += 1;
                }
                if(achievement_counts.achieved >= (achievement_counts.total / 2)) {
                    achieved_game_count_50 += 1;
                }
                if(achievement_counts.achieved >= ((achievement_counts.total / 4) + (achievement_counts.total / 2))) {
                    achieved_game_count_75 += 1;
                }
                if(achievement_counts.achieved === achievement_counts.total) {
                    achieved_game_count_100 += 1;
                }
            }
        }
        if(playtimeCache[aid] !== undefined) {
            win_count += 1;
            playtime_total += playtimeCache[aid];
            if(playtimeCache[aid] > 0) {
                playtime_game_count += 1;
            }
            if(playtimeCache[aid] >= 300) {
                playtime_game_count_5h += 1;
            }
            if(playtimeCache[aid] >= 600) {
                playtime_game_count_10h += 1;
            }
        }
        if(achievement_counts && achievement_counts.total > 0 && playtimeCache[aid]) {
            achievement_playtime_total += playtimeCache[aid];
            achievement_playtime_count += achievement_counts.achieved;
        }
    });
    if(achieved_game_count > 0) {
        $percentage.text(formatPercentage(achievement_percentage_sum, achieved_game_count, 3));
    } else {
        $percentage.text("N/A");
    }
    if(playtime_game_count !== win_count) {
        $average_total_playtime.text(formatMinutes(playtime_total / win_count) + ' per win, ' +
                                     formatMinutes(playtime_total / playtime_game_count) + ' per played win, ' +
                                     formatMinutes(playtime_total) + ' total');
    } else {
        $average_total_playtime.text(formatMinutes(playtime_total / win_count) + ' in all wins, ' +
                                     formatMinutes(playtime_total) + ' total');
    }
    $playtime_any_counts.text(formatPercentage(playtime_game_count, win_count, 3) +
                              ' (' + playtime_game_count + '/' + win_count + ')');
    $playtime_5_10_counts.text('≥5 hours: ' + formatPercentage(playtime_game_count_5h, win_count, 3) +
                               ' (' + playtime_game_count_5h + '/' + win_count +
                               '), ≥10 hours: ' + formatPercentage(playtime_game_count_10h, win_count, 3) +
                               ' (' + playtime_game_count_10h + '/' + win_count + ')');
    $achievement_any_counts.text(formatPercentage(achieved_game_count, achievement_game_count, 3) +
                                 ' (' + achieved_game_count + '/' + achievement_game_count + ')');
    $achievement_25_counts.text(formatPercentage(achieved_game_count_25, achievement_game_count, 3) +
                                    ' (' + achieved_game_count_25 + '/' + achievement_game_count + ')');
    $achievement_50_counts.text(formatPercentage(achieved_game_count_50, achievement_game_count, 3) +
                                    ' (' + achieved_game_count_50 + '/' + achievement_game_count + ')');
    $achievement_75_counts.text(formatPercentage(achieved_game_count_75, achievement_game_count, 3) +
                                    ' (' + achieved_game_count_75 + '/' + achievement_game_count + ')');
    $achievement_100_counts.text(formatPercentage(achieved_game_count_100, achievement_game_count, 3) +
                                    ' (' + achieved_game_count_100 + '/' + achievement_game_count + ')');
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
            $progress_text.text("Retrieving " + username + "'s logged playing times");
        } else if(run_status == "WON_GAMES") {
            $progress_text.text("Retrieving " + username + "'s won games");
        } else if(run_status == "ACHIEVEMENTS") {
            $progress_text.text("Retrieving " + username + "'s achievement progress (" + activeRequests + " games left to check)");
        }
        $last_updated.hide();
        $rm_key_link.hide();
    }
};

var updatePage = function(update_time) {
    enhanceWonGames();
    updateTableStats();
    displayButtons();
    updateDisplayedCacheDate(update_time);
};

var extractSubGames = function(sub, page) {
    subAppIdsCache['s'+sub] = [];
    $(".tab_item", page).each(function(i, e) {
        var $this = $(e),
            appId = $this.attr("data-ds-appid"),
            name = $this.find(".tab_item_name").text(),
            $link = $this.find(".tab_item_overlay");
        if($link.attr("href") && !winsCache['a'+appId]) {
            var type = $link.attr("href").match(/http:\/\/store.steampowered.com\/([^\/]*)\/[0-9]*\//);
            winsCache['a'+appId] = appId;
        }
        subAppIdsCache['s'+sub].push(appId);
    });
};

var extractWon = function(page) {
    var extractCount = 0;
    $(".giveaway__row-inner-wrap", page)
        .filter(function(i) {
            return $(this).find("div.giveaway__column--positive").length == 1;
        })
        .each(function(i, e) {
            var $ga_icon = $(e).find("a.giveaway__icon:has(i.fa-steam)");
            if($ga_icon.length === 1 && $ga_icon.attr("href")) {
                var url = $ga_icon.attr("href"),
                    id = url.match(/http:\/\/store.steampowered.com\/([^\/]*)\/([0-9]*)\//);
                if((id[1] == "sub" || id[1] == "subs") && !subAppIdsCache['s'+id[2]]) { // only fetch appids for uncached-subs - do subs ever change? Probably...
                    activeRequests += 1;
                    GM_xmlhttpRequest({
                        "method": "GET",
                        "url": url,
                        "onload": function(response) {
                            if(response.finalUrl === url) { // if not, probably got redirected to Steam homepage
                                extractSubGames(id[2], response.responseText);
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
                } else if((id[1] == "app" || id[1] == "apps") && !winsCache['a'+id[2]]) {
                    winsCache['a'+id[2]] = id[2];
                    extractCount += 1;
                }
            }
        });
    return extractCount;
};

var fetchWon = function(page, callback) {
    activeRequests += 1;
    GM_xmlhttpRequest({
        "method": "GET",
        "url": WINS_URL + "?page=" + page,
        "onload": function(response) {
            var count = extractWon(response.responseText);
            // stop fetching pages if no new wins found on current page
            if($("div.pagination__navigation > a > span:contains('Next')", response.responseText).length === 1 && count > 0) {
                setTimeout(function() {
                    fetchWon(page + 1, callback);
                }, WAIT_MILLIS);
            } else {
                callback();
            }
            activeRequests -= 1;
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
                console.log(games);
                if(games) {
                    for(var i = 0; i < games.length; i++) {
                        playtimeCache["a"+games[i].appid] = games[i].playtime_forever;
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
                    achievements = data.playerstats.achievements;
                    if(achievements) {
                        var achieved = achievements.filter(function(achievement) { return achievement.achieved == 1; }).length;
                        var total = achievements.length;
                        achievementCache["a"+appid] = {"achieved": achieved, "total": total};
                    } else {
                        achievementCache["a"+appid] = {"achieved": 0, "total": 0};
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

    var $featured_wrap = $(".featured__outer-wrap"),
        $featured_table = $(".featured__table"),
        $featured_table_col1 = $featured_table.children(":first-child"),
        $featured_table_col2 = $featured_table.children(":last-child");

    var $left_row_1 = $('<div class="featured__table__row"></div>'),
        $left_row_2 = $('<div class="featured__table__row"></div>'),
        $left_row_3 = $('<div class="featured__table__row"></div>'),
        $left_row_4 = $('<div class="featured__table__row"></div>'),
        $left_row_5 = $('<div class="featured__table__row"></div>'),
        $right_row_1 = $('<div class="featured__table__row"></div>'),
        $right_row_2 = $('<div class="featured__table__row"></div>'),
        $right_row_3 = $('<div class="featured__table__row"></div>'),
        $right_row_4 = $('<div class="featured__table__row"></div>'),
        $right_row_5 = $('<div class="featured__table__row"></div>'),
        $right_row_6 = $('<div class="featured__table__row"></div>');
    $toolbar.append($button_container);
    $button_container.append($key_button);
    $button_container.append($fetch_button);
    $toolbar.append($progress_container);
    $progress_container.append($progress_text);
    $toolbar.append($last_updated);
    $toolbar.append($rm_key_link);
    $featured_wrap.css('background-size','auto 100%');
    $left_row_1.append('<div class="featured__table__row__left">Average and Total Playtime</div>');
    $left_row_1.append($average_total_playtime);
    $left_row_2.append('<div class="featured__table__row__left">Games with any Playtime</div>');
    $left_row_2.append($playtime_any_counts);
    $left_row_3.append('<div class="featured__table__row__left">Games with Playtime...</div>');
    $left_row_3.append($playtime_5_10_counts);
    $left_row_4.append('<div class="featured__table__row__left">Games ≥25% Complete:</div>');
    $left_row_4.append($achievement_25_counts);
    $left_row_5.append('<div class="featured__table__row__left">Cames ≥75% Complete:</div>');
    $left_row_5.append($achievement_75_counts);
    $right_row_1.append('<div class="featured__table__row__left">Avg. Achievement Percentage</div>');
    $right_row_1.append($percentage);
    $right_row_2.append('<div class="featured__table__row__left">Games with any Achievements:</div>');
    $right_row_2.append($achievement_any_counts);
    $right_row_3.append('<div class="featured__table__row__left">Games ≥50% Complete:</div>');
    $right_row_3.append($achievement_50_counts);
    $right_row_4.append('<div class="featured__table__row__left">Games 100% Complete:</div>');
    $right_row_4.append($achievement_100_counts);
    $featured_table_col1.append($left_row_1).append($left_row_2).append($left_row_3).append($left_row_4).append($left_row_5);
    $featured_table_col2.append($right_row_1).append($right_row_2).append($right_row_3).append($right_row_4);
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
        run_status = "PLAYTIMES";
        displayButtons();
        fetchGamePlaytimes(userID64, function() {
            run_status = "WON_GAMES";
            cacheJSONValue(PLAYTIME_CACHE_KEY, playtimeCache);
            fetchWon(1, function() {
                var intervalId = setInterval(function() {
                    if(activeRequests === 0) {
                        clearInterval(intervalId);
                        run_status = "ACHIEVEMENTS";
                        cacheJSONValue(WINS_CACHE_KEY, winsCache);
                        cacheJSONValue(SUB_APPID_CACHE_KEY, subAppIdsCache);
                        GM_setValue(SUB_APPID_CACHE_VERSION_KEY, JSON.stringify(CURRENT_VERSION));
                        var i = 0;
                        $.each(winsCache, function(id, appid) {
                            activeRequests += 1;
                            // increment delay to try to prevent overloading of Steam API
                            setTimeout(fetchAchievementStatsFn(appid, userID64), i * 50);
                            i += 1;
                        });
                        intervalId = setInterval(function() {
                            if(activeRequests === 0) {
                                clearInterval(intervalId);
                                run_status = "STOPPED";
                                cacheJSONValue(ACHIEVEMENT_CACHE_KEY, achievementCache);
                                GM_setValue(USER_CACHE_VERSION_KEY, JSON.stringify(CURRENT_VERSION));
                                console.log("Errors during API queries:", errorCount);
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
        });
    });
})();
