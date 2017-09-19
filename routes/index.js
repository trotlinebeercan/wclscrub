var express = require('express');
var router  = express.Router();

var async   = require('async');
var request = require('request');

var globalLimitOnParses = 5;

///////////////////////////////////////////////////////////////////////////////
// WCL API Documentation listed at: https://www.warcraftlogs.com/v1/docs
///////////////////////////////////////////////////////////////////////////////

// have to nest multiple get requests here, since WCL API requires that we:
router.get('/', function(req, res, next) {
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
            request.get({
                url: 'https://www.warcraftlogs.com/v1/report/tables/healing/' + listItem.reportID,
                qs: {
                    end: listItem.startTime + listItem.duration,
                    api_key: "b2f299989d85016a833e3151f315de2c"
                }
            },
            function (e, r, body) {
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
