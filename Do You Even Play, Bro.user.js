// ==UserScript==
// @name         Do You Even Play, Bro?
// @namespace    https://www.steamgifts.com/user/kelnage
// @version      1.2.1
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
    SUB_APPID_CACHE_KEY = "DYEPB_SUB_APPID_CACHE";

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

var playtimeCache = {},
    achievementCache = {},
    winsCache = {},
    subAppIdsCache = {},
    activeRequests = 0,
    errorCount = 0,
    run_status = "STOPPED"; // can be STOPPED, PLAYTIME, WON_GAMES, ACHIEVEMENTS

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
if(GM_getValue(SUB_APPID_CACHE_KEY)) {
    subAppIdsCache = JSON.parse(GM_getValue(SUB_APPID_CACHE_KEY));
}

var errorFn = function(response) {
    activeRequests -= 1;
    errorCount += 1;
    console.log("Error details: ", response.status, response.responseText);
};

var formatMinutes = function(mins) {
    if(isNaN(mins)) {
        return "N/A";
    }
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
                return years.toPrecision(2) + " years";
            }
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
        if($achievementSpan.length > 0) {
            if(achievementCounts.achieved === 0) {
                $achievementSpan.text("0%");
            } else {
                $achievementSpan.text(Number(achievementCounts.achieved / achievementCounts.total * 100).toPrecision(3) + "%");
                $achievementSpan.attr('title', achievementCounts.achieved + '/' + achievementCounts.total + ' achievements');
            }
        } else {
            $heading.append('<span class="dyegb_achievement giveaway__heading__thin" title="' + achievementCounts.achieved + '/' + achievementCounts.total + ' achievements">' +
                            (achievementCounts.achieved > 0 ? Number(achievementCounts.achieved / achievementCounts.total * 100).toPrecision(3) : '0') + '%</div>');
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
                            totalAchievements.achieved += achievementCache['a'+appids[i]].total;
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
        playtime_total = 0, playtime_game_count = 0, win_count = 0;
    $.each(winsCache, function(aid, appid) {
        win_count += 1;
        var achievement_counts = achievementCache[aid];
        if(achievement_counts && achievement_counts.total > 0) {
            achievement_game_count += 1;
            if(achievement_counts.achieved > 0) {
                achievement_percentage_sum += (achievement_counts.achieved / achievement_counts.total) * 100;
                achieved_game_count += 1;
            }
        }
        if(playtimeCache[aid]) {
            playtime_total += playtimeCache[aid];
            playtime_game_count += 1;
        }
    });
    if(achieved_game_count > 0) {
        $percentage.text(Number(achievement_percentage_sum / achieved_game_count).toPrecision(3) + "%");
    } else {
        $percentage.text("N/A");
    }
    $average_playtime.text(formatMinutes(playtime_total / win_count));
    $total_playtime.text(formatMinutes(playtime_total));
    $game_counts.text(playtime_game_count + '/' + win_count + ' with playtime, ' + achieved_game_count + '/' + achievement_game_count + ' with at least one achievement');
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
            $progress_text.text("Retriving " + username + "'s logged playing times");
        } else if(run_status == "WON_GAMES") {
            $progress_text.text("Retriving " + username + "'s won games");
        } else if(run_status == "ACHIEVEMENTS") {
            $progress_text.text("Retriving " + username + "'s achievement progress (" + activeRequests + " games left to check)");
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
                            extractSubGames(id[2], response.responseText);
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
        while(STEAM_API_KEY !== "" && !API_KEY_REGEXP.test(STEAM_API_KEY)) {
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
