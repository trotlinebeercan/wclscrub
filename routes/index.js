var express = require('express');
var router  = express.Router();

var async   = require('async');
// var request = require('request');

var globalLimitOnParses = 5;

///////////////////////////////////////////////////////////////////////////////
// WCL API Documentation listed at: https://www.warcraftlogs.com/v1/docs
///////////////////////////////////////////////////////////////////////////////

var axios   = require("axios");
var request = require("request");

router.get('/one', function(req, res, next) {
    var statTable = {};
    console.log("Initial request!");
    axios.get('https://www.warcraftlogs.com/v1/rankings/encounter/2052', { // 2052 == maiden of vigilance
        params: {
            api_key: "b2f299989d85016a833e3151f315de2c",
             metric: "hps",
         difficulty: 5, // mythic
              class: 9, // shaman
               spec: 3, // restoration
             region: "US",
              limit: globalLimitOnParses
        }
    }).then(function(response) {
        console.log("Parsing top " + globalLimitOnParses + " encounters...");
        
        // TODO: 'limit' in the above request might be broken? find out, slice should not be rq here
        //var topNRankings = JSON.parse(response.data)["rankings"].slice(0, globalLimitOnParses);
        var topNRankings = response.data["rankings"];//.slice(0, globalLimitOnParses);

        var players   = [];
        var statTable = [];

        var promise_Tables = [];
        var promise_Events = [];

        topNRankings.forEach(function(listItem) {
            promise_Tables.push(axios.get(
                    'https://www.warcraftlogs.com/v1/report/tables/healing/' + listItem.reportID, {
                        params: {
                            end: listItem.startTime + listItem.duration,
                            api_key: "b2f299989d85016a833e3151f315de2c"
                        }
                    }
                ));
            console.log("Expecting a stat table for character: " + listItem.name);
            players.push({
                     name: listItem.name,
                 reportID: listItem.reportID,
                startTime: listItem.startTime,
                 duration: listItem.duration
            });
        });

        axios.all(promise_Tables)
            .then(axios.spread((...args) => {
                console.log("Retrieving only the healing information for " + args.length + " parses...");
                for (var i = 0; i < args.length; i++) {
                    var report = args[i].data.entries;
                    for (var j = 0; j < report.length; j++) {
                        if (report[j].name == players[i].name) {
                            players[i]["actorID"] = report[j].id;
                            promise_Events.push(axios.get('https://www.warcraftlogs.com/v1/report/events/' + players[i].reportID, {
                                    params: {
                                        // start: players[i].startTime,
                                        end: players[i].startTime + players[i].duration,
                                        actorid: report[j].id,
                                        api_key: "b2f299989d85016a833e3151f315de2c"
                                    }
                                }));
                            console.log('https://www.warcraftlogs.com/v1/report/events/' + players[i].reportID, {
                                params: {
                                    // start: players[i].startTime,
                                    end: players[i].startTime + players[i].duration,
                                    actorid: report[j].id,
                                    api_key: "b2f299989d85016a833e3151f315de2c"
                                }
                            });
                            break;
                        }
                    }
                }
            }))
            .then(function(response) {
                axios.all(promise_Events)
                    .then(axios.spread((...args) => {
                        console.log("Retrieving stats for " + args.length + " individual healers...");
                        for (var i = 0; i < args.length; i++) {
                            var events = args[i].data.events;
                            for (var j = 0; j < events.length; j++) {
                                if (events[j].sourceID == players[i].actorID) {
                                    if (events[j].type == "combatantinfo") {
                                        statTable.push({
                                                playerName: players[i].name,
                                                playerCrit: events[j].critSpell,
                                                playerHaste: events[j].hasteSpell,
                                                playerMastery: events[j].mastery,
                                            playerVersatility: events[j].versatilityHealingDone
                                        });
                                        console.log("Added stats for character: " + players[i].name);
                                        break;
                                    }
                                }
                            }
                        }
                    }))
                    .then(function(response) {
                        return res.render('index', { title: 'Express', statTable: statTable });
                    }).catch(function(error) { console.log(error); });
            }).catch(function(error) { console.log(error); });
    }).catch(function(error) { console.log(error); });
    
    /*
    .spread(function(response, body) {
        console.log(body);
        return res.render('index', { title: 'Express', statTable: 0 });
    });
    */
});

// have to nest multiple get requests here, since WCL API requires that we:
router.get('/two', function(req, res, next) {
    // 1. request the top N (by 'limit') "encounters" for a specific fight in a raid
    //    example output:
    //    { CharacterName, EncounterID } x 'limit'
    request.get({
        url: 'https://www.warcraftlogs.com/v1/rankings/encounter/2052', // 2052 = Maiden in ToS
        qs: {
            api_key: "b2f299989d85016a833e3151f315de2c",
             metric: "hps",
         difficulty: 5, // mythic
              class: 9, // shaman
               spec: 3, // restoration
              limit: globalLimitOnParses
        }
    },
    // 2. for each encounter from #1, request the "healing" report to retrieve
    //    the specific report ID for #3
    //    example output (per request, not a table):
    //    CharacterName, HealingTableIDPerReport, FightStartTime, EncounterLength
    function(e, r, body) {
        console.log("Parsing top " + globalLimitOnParses + " rankings...");

        // TODO: 'limit' in the above request might be broken? find out, slice should not be rq here
        var top100rankings = JSON.parse(body)["rankings"].slice(0, globalLimitOnParses);

        var reportIds = [];
        async.eachSeries(top100rankings, function iteratee(listItem, callback) {
            console.log("punch");
            request.get({
                url: 'https://www.warcraftlogs.com/v1/report/tables/healing/' + listItem.reportID,
                qs: {
                    end: listItem.startTime + listItem.duration,
                    api_key: "b2f299989d85016a833e3151f315de2c"
                }
            },
            function (e, r, body) {
                console.log("kick");
                var report = JSON.parse(body).entries;
                for (var idx = 0; idx < report.length; idx++) {
                    if (report[idx].name == listItem.name) {
                        console.log("Storing report for character " + report[idx].name + " into database...");
                        reportIds.push({
                            name: report[idx].name,
                            id: report[idx].id,
                            reportID: listItem.reportID,
                            startTime: listItem.startTime,
                            duration: listItem.duration
                        });
                        break;
                    }
                }
                callback(e, body);
            });
        },
        // 3. for each specific healer report from #2, request the actual character-specific
        //    table from the healing report (i.e. stats, gear, etc)
        //    example output (per request, not a table):
        //    CharacterName, Stats: [crit, mastery, haste, vers, mainstat], Gear: [...]
        function done() {
            console.log("Finished. Retrieving stats...");

            var statTable = [];
            async.eachSeries(reportIds, function iteratee(listItem, callback) {
                request.get({
                    url: 'https://www.warcraftlogs.com/v1/report/events/'+listItem.reportID,
                    qs: {
                        end: listItem.startTime + listItem.duration,
                        actorid: listItem.id,
                        api_key: "b2f299989d85016a833e3151f315de2c"
                    }
                },
                function (e, r, body) {
                    var events = JSON.parse(body).events;
                    for (var idx = 0; idx < events.length; idx++) {
                        if (events[idx].sourceID == listItem.id && events[idx].type == "combatantinfo") {
                            statTable.push({
                                playerName: listItem.name,
                                playerCrit: events[idx].critSpell,
                                playerHaste: events[idx].hasteSpell,
                                playerMastery: events[idx].mastery,
                                playerVersatility: events[idx].versatilityHealingDone
                            });
                            console.log("Added object: " + statTable);
                            break;
                        }
                    }
                    callback(e, body);
                });
            },
            // 4. fucking 8 minutes later (per 100 reports), we can finally render the
            //    cached results to the page
            function done() {
                console.log("Finished. Rendering page...");
                res.render('index', { title: 'Express', statTable: statTable });
            });
        });
    });
});

module.exports = router;
