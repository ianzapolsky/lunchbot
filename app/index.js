// Source for the AppNexus lunch-bot Slack bot, an AppNexus 2015 HackU Hackathon Project
// Developed by Ian Zapolsky, Ben Barg, Aaron Himelman, and Ruchir Khaitan (AKA Warbrides)

var exec = require('child_process').exec;
var fs = require('fs');
var Slack = require('slack-client');
if (!process.env.SLACK_TOKEN) {
    console.log('$SLACK_TOKEN is not set.');
    process.exit();
}
var token = process.env.SLACK_TOKEN;
var slack = new Slack(token, true, true);

slack.login();

// Every 10 seconds, check to delete expired lunchrooms and remind users of upcoming lunches
setInterval(function() {
    deleteExpiredLunchrooms();
    sendReminders();
}, 10000);

// Every 10 seconds, write lunchrooms to file
setInterval(function() {
    saveLunchrooms();
}, 10000);

///////////////////////////////////
// Databases
///////////////////////////////////

// Dictionary indexed by appnexus username that contains various
// employee data.
var employees = require('./employees.js');

// Array of responses to say when a message neccesitates no functional action
var responses = [
    'hello there!',
    'ready for lunch?',
    'type `help` to see what I can do',
    'please stop bothering me'
];

// Store the state of interacting users:
//   0 = just created
//   1 = 'where'
//   2 = 'when'
//   3 = 'meet'
var userState = {};

// Global array that stores all lunch rooms
var lunchrooms = [];

///////////////////////////////////
// Slack event hooks
///////////////////////////////////

// Copied from slack-client sample code
slack.on('open', function () {
    var channels = Object.keys(slack.channels)
        .map(function (k) { return slack.channels[k]; })
        .filter(function (c) { return c.is_member; })
        .map(function (c) { return c.name; });
    var groups = Object.keys(slack.groups)
        .map(function (k) { return slack.groups[k]; })
        .filter(function (g) { return g.is_open && !g.is_archived; })
        .map(function (g) { return g.name; });
    console.log('Welcome to Slack. You are ' + slack.self.name + ' of ' + slack.team.name + '.');
    if (channels.length > 0) {
        console.log('Channels you are in: ' + channels.join(', '));
    }
    if (groups.length > 0) {
       console.log('Groups you are in: ' + groups.join(', '));
    }
    console.log('Loading saved lunchroom data:');
    fs.readFile('./app/lunchrooms.db', 'utf8', function(err, data) {
        if (err) {
            console.log(err);
            return;
        }
        lunchrooms = JSON.parse(data);
        lunchrooms.forEach(function(room) {
            room['when'] = new Date(room['when']);
        });
        console.log('Done');
    });
});

// Main response logic
slack.on('message', function(message) {
    var channel = slack.getChannelGroupOrDMByID(message.channel);
    var cType = channel.getType();
    // Note that channel can be the name of one of three different objects:
    //   1. The sending user, if cType == 'DM'
    //   2. The channel the message was sent in, if cType == 'Channel'
    //   3. The group the message was sent in, if cType == 'Group'
    var user = slack.getUserByID(message.user);
    if (!user) {
        return;
    }

    var userDM = slack.getDMByName(user.name);
    if (!userDM) {
        return;
    }

    // remove backslashes from input
    message.text = message.text.replace('\\', '').trim();

    if (message.type === 'message' && (cType === 'DM' || isDirect(slack.self.id, message.text))) {

        // set the message text to all lower case for case-insensitive matching
        message.text = message.text.toLowerCase();

        if (message.text.indexOf('help') > -1) {
            userDM.send(print_help());
            return;
        }

        if (message.text.indexOf('describe') > -1) {
            if (message.text.length > 8) {
                var term = message.text.substring(message.text.indexOf('describe') + 9);
            } else {
                userDM.send('please enter a restaurant name for me to find.');
                return;
            }
            exec('python app/randomize.py --describe "' + term + '"', function(err, stdout, stderr) {
                var rspot = JSON.parse(stdout);
                if (rspot['url']) {
                    userDM.send(rspot['url']);
                } else {
                    userDM.send('sorry, I dont\'t know what that is.');
                }
            });
            return;
        }

        if (message.text.indexOf('create') > -1) {
	          if (userState[user.name] == null && !ownsRoom(user.name)) {
		            userState[user.name] = {'state': 0};
		            handle_user_state(user, message);
		            return;
	          }
	          else if (userState[user.name] >= 0) {
		            userDM.send("looks like you're already in the middle of creating a lunch group!");
                return;
	          } else if (ownsRoom(user.name)) {
		            userDM.send("looks like you already created a lunch group!");
                return;
            }
        }

        if (message.text.indexOf('who') > -1) {
	          if (lunchrooms.length > 0 ) {
                // if the user typed "who channel", send back only the lunchrooms created by members of that channel
                if ((message.text.indexOf('channel')) > -1 && (cType != 'DM')) {
                    userDM.send(list_lunchrooms(lunchrooms, channel));
                }
                // otherwise, send back all the lunchrooms
                else {
                    userDM.send(list_lunchrooms(lunchrooms, 0));
                }
                return;
	          }
            else {
		            userDM.send('looks like no one is planning lunch yet.\ntype `create` to set up your lunch adventure');
                return;
	          }
        }

        if (message.text.indexOf('join') > -1) {
	          if (userState[user.name] >= 0) {
		            userState[user.name] = null;
	          }

	          if (lunchrooms.length == 0) {
		            userDM.send('looks like no one is planning lunch yet.\ntype `create` to set up your lunch adventure');
		            return;
	          }

            var id = parseInt(message.text.replace(/^\D+/g, ''));

            if (id <= lunchrooms.length && id > 0) {
                if (lunchrooms[id - 1]['creator'] == user.name || lunchrooms[id - 1]['who'].indexOf(user.name) > -1) {
                    userDM.send('you\'re already a member of this lunchroom!');
                    return;
                }

                lunchrooms[id - 1]['who'].push(user.name);
                userDM.send('you joined lunchroom ' + id);

                // Notify creator of lunchroom that someone has joined him/her
                var creatorDM = slack.getDMByName(lunchrooms[id - 1]['creator']);
                creatorDM.send(makeMention(user.name) + ' from ' + employees.db[user.name]['department'] + ' just joined your lunchroom');
                return;
            }
            else {
                userDM.send('Sorry that id seems incorrect. Type \"join (id)\" to get lunch with a group!');
                return;
            }
        }

        // if no commands were called, handle user state
        handle_user_state(user, message);
    }
});

///////////////////////////////////
// State management
///////////////////////////////////

// check if a user is the creator of a room
function ownsRoom(user) {
    lunchrooms.forEach(function(room) {
        if (room['creator'] === user) {
            return true;
        }
    });
    return false;
};

// offset parameter represents the timezone of the user
// returns an object with lunch time and current time, adjusted for time zone
function getRelativeTime(room, offset) {
    var now = new Date();
    // if hour is 1 - 9, we assume user means PM
    if (room['when'].getHours() >= 1 && room['when'].getHours() <= 9) {
        var hour = room['when'].getHours() + 12;
    } else {
        var hour = room['when'].getHours();
    }
    return {
      'm': room['when'].getMinutes(),
      'h': hour,
      'nm': now.getMinutes(),
      'nh': now.getHours() + offset
    };
};

// Check if the leaving time has passed for a room
function hasLeft(room) {
    var time = getRelativeTime(room, -4);
    if (time['nh'] > time['h']) {
        return true;
    } else if (time['nh'] === time['h'] && time['nm']> time['m']) {
        return true;
    }
    return false;
};

// Check if a room is more than 30 minutes old
function isExpired(room) {
    var time = getRelativeTime(room, -4);
    if (time['nh'] > time['h']) {
        if (time['nh'] > time['h']) {
            if (time['nh'] > time['h'] + 1) {
                return true;
            } else if (time['nm'] + 60 - time['m'] > 30) {
                return true;
            }
        }
    } else if (time['nh'] == time['h']) {
        if (time['nm'] > time['m'] + 30) {
            return true;
        }
    }
    return false;
};

// Check the time remaining until the leave time for a room
function minutesLeft(room) {
    var time = getRelativeTime(room, -4);
    if (time['nh'] == time['h']) {
        return time['m'] - time['nm'];
    } else if (time['nh'] == time['h'] - 1) {
        return 60 - time['nm'] + time['m'];
    } else {
        return 60;
    }
};

function deleteExpiredLunchrooms() {
    for (var i = 0; i < lunchrooms.length; i++) {
        if (isExpired(lunchrooms[i])) {
	          var userDM = slack.getDMByName(lunchrooms[i]['creator']);
            userDM.send('hi! i\'m writing to let you know that i just deleted your lunchroom because it\'s more than 30 minutes old!');
            lunchrooms.splice(i, 1);
        }
    }
};

function sendReminders() {
    lunchrooms.forEach(function(room) {
        if (room['reminded'] == null) {
            var timeRemaining = minutesLeft(room);
            if (timeRemaining < 6) {
	              var userDM = slack.getDMByName(room['creator']);
                if (room['who'].length == 0) {
                    var guests = 'nobody else';
                } else {
                    var guests = room['who'].join(', ');
                }
                userDM.send('hi! i\'m writing to remind you that you\'re going to '+room['where']+' with '+guests+' in '+timeRemaining+' minutes!');
                room['who'].forEach(function(user) {
                    var userDM = slack.getDMByName(user);
                    userDM.send('hi! i\'m writing to remind you that you are going to '+room['where']+' with '+room['creator']+', '+guests+' in '+timeRemaining+' minutes!');
                });
                room['reminded'] = true;
            }
        }
    });
};

function saveLunchrooms() {
    fs.writeFile('./app/lunchrooms.db', JSON.stringify(lunchrooms));
};

function handle_user_state(user, message) {
	  var userDM = slack.getDMByName(user.name);
    if (userState[user.name]) {
        switch (userState[user.name]['state']) {
            case 0:
                // user just typed 'create'
                // now prompt for where
                userState[user.name]['state'] += 1;
                userDM.send('where do you want to eat? (type \"random\" if you can\'t decide)');
                break;
            case 1:
                // user just typed where they want to eat
                if (message.text.indexOf('random') > -1) {
                    if (message.text.length > 6) {
                        var term = message.text.substring(message.text.indexOf('random') + 7);
                    } else {
                        var term = 'lunch';
                    }
                    exec('python app/randomize.py --term="'+term+'"', function(err, stdout, stderr) {
                        var rspot = JSON.parse(stdout);
                        userDM.send('cool, we randomly selected ' + rspot['name'] + ' for you, which is at ' + rspot['location'] + ', ' + rspot['distance'] + ' miles away ['+rspot['url']+'].');
                        userState[user.name]['where'] = rspot['name'];
                        userState[user.name]['url'] = rspot['url'];
                        userState[user.name]['state'] += 1;
                        userDM.send('when do you want to leave? (or if you don\'t like the selection, type random again)');
                    });
                } else {
                    userState[user.name]['where'] = message.text;
                    userDM.send('great, you\'re going to '+ message.text +'.\nwhen do you want to leave?');
                    userState[user.name]['state'] += 1;
                }
                break;
            case 2:
                if (message.text.indexOf('random') > -1) {
                    // user typed random again - he/she didn't like the last random restaurant
                    if (message.text.length > 6) {
                        var term = message.text.substring(message.text.indexOf('random') + 7);
                    } else {
                        var term = 'lunch';
                    }
                    exec('python app/randomize.py --term="'+term+'"', function(err, stdout, stderr) {
                        var rspot = JSON.parse(stdout);
                        userDM.send('cool, we randomly selected ' + rspot['name'] + ' for you, which is at ' + rspot['location'] + ', ' + rspot['distance'] + ' miles away ['+rspot['url']+']');
                        userState[user.name]['where'] = rspot['name'];
                        userState[user.name]['url'] = rspot['url'];
                        userDM.send('when do you want to leave? (or if you don\'t like the selection, type random again)');
                    });
                } else {
                    // user just typed when they want to eat
                    var time = message.text.match(/^([0-9]|0[0-9]|1[0-9]|2[0-3]):([0-5][0-9])$/);
                    if (time) {
                        var today = new Date();
                        var lunchtime = new Date(today.getYear(), today.getMonth(), today.getDay(), parseInt(time[1]), parseInt(time[2]));
                        userState[user.name]['when'] = lunchtime;
                        userState[user.name]['state'] += 1;
                        userDM.send('where do you want to meet?');
                    } else {
                        userDM.send('sorry, that wasn\'t a valid time. please input a time like 12:37, or 1:12');
                    }
                }
                break;
            case 3:
                // user just typed where they want to meet
                // now we create the object and delete from userState
                userState[user.name]['meet'] = message.text;
                lunchroom = {
                    'creator': user.name,
                    'where': userState[user.name]['where'],
                    'when': userState[user.name]['when'],
                    'meet': userState[user.name]['meet'],
                    'url': userState[user.name]['url'],
                    'who': []
                }
                lunchrooms.push(lunchroom);
                userState[user.name] = null;
                userDM.send('great, we created your lunch room!');
        }
    } else {
        userDM.send(responses[Math.floor(Math.random()*responses.length)]);
    }
};

///////////////////////////////////
// Slack utility functions
///////////////////////////////////

function makeMention(userId) {
    return '<@' + userId + '>';
};

function isDirect(userId, messageText) {
    var userTag = makeMention(userId);
    return messageText &&
           messageText.length >= userTag.length &&
           messageText.substr(0, userTag.length) === userTag;
};

function getOnlineHumansForChannel(channel) {
    if (!channel) return [];
    return (channel.members || [])
        .map(function(id) { return slack.users[id].name; });
};

function isInChannel(channel, creator) {
    if (getOnlineHumansForChannel(channel).indexOf(creator) > -1) {
        return true;
    }
    return false;
};

///////////////////////////////////
// Print functions
///////////////////////////////////

function print_help() {
    return "Here's what I can do:\n" +
        "`who` - send this to me find out who's hungry right now\n" +
        "`join` - after typing `who`, tell me what number table you'd like to join\n" +
        "`create` - send this to me when you want to start your own lunch group\n" +
	      "`describe` - for example: tell me `describe oxido` to learn more about Oxido (AppNexians go to all the hip restaurants!)";
};

// Returns string of lunchroom object in human readable format.
//
// e.g. Daphne from PMC is going to Oxido with Tom and Ben at 3:00 PM.
function print_lunchroom(room) {
    function print_guests(guests) {
	if (guests.length > 0) {
	    mentions = guests.map(function(username) {
		return makeMention(username)
	    });
	    return 'with ' + mentions.join(', ') + ' ';
	}
	return '';
    };

    function print_creator(creator) {
	      // Look up department in db 
	      if (creator in employees.db) {
	          return makeMention(creator) + " from " + employees.db[creator]['department'] + ' '
	      }
	      return creator + ' '
    };

    function print_time(time) {
        if (time.getMinutes() < 10) {
            var minutes = "0" + time.getMinutes();
        } else {
            var minutes = time.getMinutes();
        }
        return time.getHours() + ':' + minutes;
    };

    function print_where(room) {
        if (room['url']) {
            return room['where'] + ' ['+room['url']+']';
        } else {
            return room['where'];
        }
    };

    if (hasLeft(room)) {
        return print_creator(room['creator']) + 'went to ' + print_where(room) + ' '
            + print_guests(room['who']) + 'at ' + print_time(room['when'])
            + ', from ' + room['meet'];
    } else {
        return print_creator(room['creator']) + 'is going to ' + print_where(room) + ' '
            + print_guests(room['who']) + 'at ' + print_time(room['when'])
            + ', meeting at ' + room['meet'];
    }
};

function print_user_lunch(room) {
    function print_guests(guests) {
	      if (guests.length > 0) {
	          return "with " + guests.join(", ") + " ";
	      }
	      return "";
    };

    return "You are going to " + room['where'] + " "
	      + print_guests(room['who'])
	      + "at " + room['when'] + ", meeting at " + room['meet'];
};

function print_user_room(user) {
   for(room in lunchrooms) {
      if (room['creator'] == user.name) {
          return print_user_lunch(room);
      }
  }
};

// Returns a string listing all of the available lunchrooms
function list_lunchrooms (rooms, channel) {
    var rooms_string = "";
    if (channel != 0) {
        for (var i = 0; i < rooms.length; i++) {
            if (isInChannel(channel, rooms[i].creator)) {
	              // make list 1-indexed
	              rooms_string += (i + 1) + ") " + print_lunchroom(rooms[i]) + "\n\n";
            }
        }
    }
    else {
        for (var i = 0; i < rooms.length; i++) {
	          // make list 1-indexed
	          rooms_string += (i + 1) + ") " + print_lunchroom(rooms[i]) + "\n\n";
        }
    }
    return rooms_string;
};

