var http = require('http');
var https = require('https');
var url = require('url');
var storage = require('node-persist');

//node-persist
storage.initSync();

// mysql connector
var mysql      = require('mysql');
var connection = mysql.createConnection({
  host      : 'ntuedm.c0em9fik78su.ap-southeast-1.rds.amazonaws.com',
  port      : '3306',         // MySQL server port number (default 3306)
  database  : 'ntuedm',       // MySQL database name
  user      : 'school',       // MySQL username
  password  : 'pass'          // password
});

var operational;

// mapping phaseID to phaseTry in the DB
palmviewActivityMapper = new Object();
palmviewActivityMapper[16] = 1;
palmviewActivityMapper[17] = 2;
palmviewActivityMapper[18] = 3;
palmviewActivityMapper[19] = 4;
palmviewActivityMapper[20] = 5;
palmviewActivityMapper[24] = 6;
palmviewActivityMapper[25] = 7;
palmviewActivityMapper[26] = 8;
palmviewActivityMapper[27] = 9;
var activityMapper = new Object();
activityMapper[2] = palmviewActivityMapper;

var routes = {
  // calculate the values across questions
  "/api/initialize": function(parsedUrl) {
    operational = storage.getItemSync('operational');
    if (!operational) {
      operational = new Object();
      operational.schools = new Array();
      operational.classes = new Array();
      operational.students = new Array();
      storage.setItemSync('operational', operational);
      sendResponse('initialized!');
    }
    sendResponse('loaded!');
  },
  // create student nodes
  "/api/createnode": function(parsedUrl) {
    if (!operational)
      console.error('initialize first!');

    studentID = parsedUrl.query.studentID;
    schoolID = parsedUrl.query.school;

    if (studentID) {  // update only this student's info
      connection.query('SELECT s.studentID, s.studentName AS username, sn.name AS name, sch.schoolID, sch.schoolName, c.classID, c.className, t.teacherID, t.teacherName, sub.subjID, sub.subjName, en.progress '+
                       'FROM STUDENT AS s '+
                       'INNER JOIN STUDENTNAME as sn ON s.studentName = sn.alias '+
                       //'LEFT OUTER JOIN STUDENTNAME as sn ON s.studentName = sn.alias '+
                       'INNER JOIN CLASS as c ON s.classID = c.classID '+
                       'INNER JOIN TEACHER as t ON s.teacherID = t.teacherID '+
                       'INNER JOIN SCHOOL as sch ON s.schoolID = sch.schoolID '+
                       'INNER JOIN ENROL as en on s.studentID = en.studentID '+
                       'INNER JOIN SUBJECT as sub on en.subjID = sub.subjID '+
                       'WHERE s.studentID = '+studentID+';'
                       , student_query_handler);
    }
    else if (schoolID) {
      connection.query('SELECT s.studentID, s.studentName AS username, sn.name AS name, sch.schoolID, sch.schoolName, c.classID, c.className, t.teacherID, t.teacherName, sub.subjID, sub.subjName, en.progress '+
                       'FROM STUDENT AS s '+
                       'INNER JOIN STUDENTNAME as sn ON s.studentName = sn.alias '+
                       //'LEFT OUTER JOIN STUDENTNAME as sn ON s.studentName = sn.alias '+
                       'INNER JOIN CLASS as c ON s.classID = c.classID '+
                       'INNER JOIN TEACHER as t ON s.teacherID = t.teacherID '+
                       'INNER JOIN SCHOOL as sch ON s.schoolID = sch.schoolID '+
                       'INNER JOIN ENROL as en on s.studentID = en.studentID '+
                       'INNER JOIN SUBJECT as sub on en.subjID = sub.subjID '+
                       'WHERE s.schoolID = ' +schoolID+ ';'
                       , student_query_handler); 
    }
    else {  // update the whole db
      connection.query('SELECT s.studentID, s.studentName AS username, sn.name AS name, sch.schoolID, sch.schoolName, c.classID, c.className, t.teacherID, t.teacherName, sub.subjID, sub.subjName, en.progress '+
                       'FROM STUDENT AS s '+
                       'INNER JOIN STUDENTNAME as sn ON s.studentName = sn.alias '+
                       //'LEFT OUTER JOIN STUDENTNAME as sn ON s.studentName = sn.alias '+
                       'INNER JOIN CLASS as c ON s.classID = c.classID '+
                       'INNER JOIN TEACHER as t ON s.teacherID = t.teacherID '+
                       'INNER JOIN SCHOOL as sch ON s.schoolID = sch.schoolID '+
                       'INNER JOIN ENROL as en on s.studentID = en.studentID '+
                       'INNER JOIN SUBJECT as sub on en.subjID = sub.subjID '+
                       'WHERE 1;'
                       , student_query_handler);
    }

    function student_query_handler(err, rows) {
      if (err) {
        console.error('error connecting: ' + err.stack);
        return;
      }

      if (!rows || rows.length < 1) {
        console.log('no log');
        return;
      }

      var time_profiler = new Date();
      
      rows.forEach(function(row){ // rewrite the whole student DB, regardless the presence of the old data
        //studentNode = storage.getItemSync('student_'+row.studentID);
        //if (!studentNode) { // create the studentNode if not exist
          //studentNode = new Object();
          //storage.setItemSync('student_'+row.studentID, studentNode);
        //}
        studentNode = new Object();

        var exclude = ['subjID', 'subjName', 'progress'];

        for (var attr in row)
          if ( exclude.indexOf(attr) < 0 )
            studentNode[attr] = row[attr];
        
        if (!studentNode['subjects'])
          studentNode['subjects'] = new Object;
        if (!studentNode.subjects[row.subjID])
          studentNode.subjects[row.subjID] = new Object;

        studentNode.subjects[row.subjID].name = row.subjName;
        studentNode.subjects[row.subjID].progress = row.progress;

        if (operational.students.indexOf(studentNode.studentID) < 0)
          operational.students.push(studentNode.studentID);
        storage.setItemSync('student_'+row.studentID, studentNode);
      });

      storage.setItemSync('operational', operational);

      console.log('parsing complete, time spent: '+ ((new Date()).getTime() - time_profiler.getTime()) );
      sendResponse('parsing complete, time spent: '+ ((new Date()).getTime() - time_profiler.getTime()) );

      //connection.end();
    }

    //console.log('shot, it is async');

  },
  // query to the log of the database and consolidate it into student node
  "/api/parselog": function(parsedUrl) {
    studentID = parsedUrl.query.studentID;
    sessionID = parsedUrl.query.sessionID;
    
    if (!studentID) { // rebuild the log for all the students !!!! set to process palmview's data first
      connection.query( 'SELECT LOG.time, LOG.duration, LOG.actionType, LOG.action, LOG.target1, LOG.target2, LOG.phaseID, LOG.correct, LOG.studentID, LOG.sessionID FROM LOG INNER JOIN STUDENT ON  `LOG`.studentID =  `STUDENT`.studentID AND  '
        +'`STUDENT`.schoolID = 2 ORDER BY  `LOG`.studentID,  `LOG`.`logID`'
        , log_query_handler)
    } else if (!sessionID) {  // (re)build the log for the student with studentID
      connection.query('SELECT time, duration, actionType, action, target1, target2, phaseID, correct, studentID, sessionID FROM `LOG` WHERE studentID = '+studentID+' ORDER BY `logID`'
        ,log_query_handler);
    } else {  // (re)build a session
      connection.query('SELECT time, duration, actionType, action, target1, target2, phaseID, correct, studentID, sessionID FROM `LOG` WHERE studentID = '+studentID+' AND sessionID = '+sessionID+' ORDER BY `logID`'
        ,log_query_handler);
    }

    function log_query_handler(err, rows) {
      if (err) {
        console.error('error connecting: ' + err.stack);
        return;
      }

      if (!rows || rows.length < 1) {
        console.log('no log');
        return;
      }

      var time_profiler = new Date();

      var currentStudentID;
      var currentSessionID;
      var currentActivityID;
      var currentStudentNode;
      var currentSessionNode;
      var currentActivityNode;

      var node_to_exclude = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 131, 132];

      rows.forEach(function(row){
        if (node_to_exclude.indexOf(row.studentID) > -1)
          return;

        if (row.studentID != currentStudentID) {
          // store the old node
          if (currentStudentNode) {
            storage.setItemSync('student_'+currentStudentID, currentStudentNode);
          }

          // new student node, everything new
          currentStudentID = row.studentID;
          currentStudentNode = storage.getItemSync('student_'+currentStudentID);
          if (!currentStudentNode) {
            console.log('no student: '+row.studentID+', do student_query first!');
            //sendResponse('no student: '+studentID+', do student_query first!');
            return;
          }

          currentSessionID = null;
          currentSessionNode = null;
          currentActivityID = null;
          currentActivityNode = null;

          if (!currentStudentNode.subjects[Object.keys(currentStudentNode.subjects)[0]].sessions)
            currentStudentNode.subjects[Object.keys(currentStudentNode.subjects)[0]].sessions = new Array();
        }

        if (row.sessionID != currentSessionID) {
          currentSessionID = row.sessionID;
          currentSessionNode = new Object();
          currentSessionNode.sessionID = currentSessionID;
          currentSessionNode.activities = new Array();
          currentStudentNode.subjects[Object.keys(currentStudentNode.subjects)[0]].sessions.push(currentSessionNode);

          currentActivityID = null;
          currentActivityNode = null;
        }

        if (row.phaseID != currentActivityID) {
          currentActivityID = row.phaseID;
          currentActivityNode = new Object();
          currentActivityNode.activityID = activityMapper[2][currentActivityID];
          currentActivityNode.events = new Array();
          currentSessionNode.activities.push(currentActivityNode);
        }

        var eventNode = new Object();
        eventNode.time = row.time;
        eventNode.duration = row.duration;
        eventNode.actionType = row.actionType;
        eventNode.action = row.action;
        eventNode.target1 = row.target1;
        eventNode.target2 = row.target2;
        eventNode.correct = row.correct;

        currentActivityNode.events.push(eventNode);
      });

      //processStudentLog(currentStudentNode);

      // last studentNode
      storage.setItemSync('student_'+currentStudentID, currentStudentNode);

      console.log('parsing complete, time spent: '+ ((new Date()).getTime() - time_profiler.getTime()) );
      sendResponse('parsing complete, time spent: '+ ((new Date()).getTime() - time_profiler.getTime()) );
    }

    //connection.end();
  },
  "/api/processLog": function(parsedUrl) {
    studentID = parsedUrl.query.studentID;
    sessionID = parsedUrl.query.sessionID;
    
    if (!studentID) {
      operational.students.forEach(function(studentID){
        var studentNode = storage.getItemSync('student_'+studentID);
        processStudentLog(studentNode);
        storage.setItemSync('student_'+studentID, studentNode);
      });
    } else if (!sessionID) {  // (re)build the log for the student with studentID
      var currentStudentNode = storage.getItemSync('student_'+studentID);
      processStudentLog(currentStudentNode);
      storage.setItemSync('student_'+studentID, currentStudentNode);
    } else {  // (re)build a session
      // TODO: do we really need it?
    }

    console.log('done');
    return {};
  },
  // calculate the values across cohort
  "/api/macro": function(parsedUrl) {
    return {unixtime: (new Date(parsedUrl.query.iso)).getTime()};
  },
  // calculate the values across questions
  "/api/questions": function(parsedUrl) {
    return {unixtime: (new Date(parsedUrl.query.iso)).getTime()};
  },
  // retrive student node
  "/api/retrieve": function(parsedUrl) {
    return {};
  }
}

var currentSubjectNode;
var currentSessionNode;
var currentActivityNode;
var activityStart;
var activityEnd;

var videoDuration = {
  '68ihQ9jQOM8':73,
  'Jowey_prtVM':86,
  'pjjSp46ffjQ':48,
  'bwm5pv3UiYE':75,
  'LlFw4UPv4L4':81,
  'Jx9mtdx-7aQ':48,
  'jcc0WBVtO90':73,
  '0lf0YACerzY':81,
  'bDXedeH-Bpo':75,
  'zJUaLHvLP6s':86
};

function processStudentLog(studentNode) {
  if (!studentNode) {
    console.error('student node is undefined!');
    return;
  }

  Object.keys(studentNode.subjects).forEach(function(subjectKey){

    currentSubjectNode = studentNode.subjects[subjectKey];
    if (currentSubjectNode.progress <= 1) 
      return;
    if (!currentSubjectNode.sessions) { // somehow student with no actions came to further progress (e.g, studentID = 257)
      currentSubjectNode.progress = 1;
      return;
    }
    currentSubjectNode.sessions.forEach(function(_sessionNode){

      currentSessionNode = _sessionNode;
      currentSessionNode.activities.forEach(function(_activity){

        currentActivityNode = _activity;
        activityStart = null;
        activityEnd = null;
        currentEventTimeStamp = null;

        currentActivityNode.offTask = new Object();
        currentActivityNode.offTask.instances = [];
        currentActivityNode.offTask.totalduration = 0;
        var offTaskIndex = -1;

        currentActivityNode.videos = new Object();
        var currentVideoNode = null;
        var currentVideoID = '';
        var currentVideoPlayTime = 0;
        var currentVideoStartTime = 0;
        var previousPlayTime = 0;
        var previousStartTime = 0;

        currentActivityNode.activities = [];
        currentActivityNode.mcqs = [];

        currentActivityNode.events.forEach(function(_event){
          currentEventTimeStamp = new Date(_event.time);
          // general 
          if (_event.actionType == 'start') {
            activityStart = new Date(_event.time);
            return;
          }

          if (activityStart == null)
            activityStart = currentEventTimeStamp;

          if (_event.actionType == 'pageActivity') {
            if (_event.action == 'leave_page') {
              offTaskIndex ++;
              currentActivityNode.offTask.instances[offTaskIndex] = new Object();
              currentActivityNode.offTask.instances[offTaskIndex].startTime = new Date(_event.time);
              currentActivityNode.offTask.instances[offTaskIndex].duration = -1;
            } else if (_event.action == 'alt_page') {
              if (offTaskIndex < 0 || currentActivityNode.offTask.instances[offTaskIndex].duration >= 0) {
                offTaskIndex ++;
                currentActivityNode.offTask.instances[offTaskIndex] = new Object();
                currentActivityNode.offTask.instances[offTaskIndex].startTime = new Date(_event.time - _event.duration);
              }
              currentActivityNode.offTask.instances[offTaskIndex].duration = _event.duration;
              currentActivityNode.offTask.totalduration += _event.duration;
            }
            return;
          }

          if (_event.actionType == "mouseClick" && _event.action.indexOf("video_") == 0) {
            if (_event.action == 'video_start') {
              if (currentVideoID !=  _event.target1) { // new video play
                currentVideoID = _event.target1;
                currentVideoPlayTime = Number(_event.target2);
                currentVideoStartTime = new Date(_event.time);
                currentVideoNode = new Object();
                currentVideoNode.activeDuration = 0;
                currentVideoNode.playedIntervals = [];
                currentVideoNode.pauses = [];

                currentVideoNode.playedIntervals.push({start:currentVideoPlayTime, end:null});

                if (!currentActivityNode.videos[currentVideoID])
                  currentActivityNode.videos[currentVideoID] = [];
                currentActivityNode.videos[currentVideoID].push(currentVideoNode);

              } else { // seek to another location/pause then resume
                currentVideoPlayTime = Number(_event.target2);
                
                if (currentVideoNode.playedIntervals[currentVideoNode.playedIntervals.length-1].end == null) { // calculate previous played interval
                  currentVideoNode.playedIntervals[currentVideoNode.playedIntervals.length-1].end = previousPlayTime + ((new Date(_event.time)).getTime() - previousStartTime.getTime())/1000 ;
                }

                currentVideoNode.playedIntervals.push({start:currentVideoPlayTime, end:null});

                // if it is a resume after pause
                if (currentVideoNode.pauses.length > 0 && currentVideoNode.pauses[currentVideoNode.pauses.length-1].end == null)
                  currentVideoNode.pauses[currentVideoNode.pauses.length-1].end = new Date(_event.time);
              }

              previousStartTime = new Date(_event.time);
              previousPlayTime = Number(_event.target2);

            } else if (_event.action == 'video_end') {
              if (!currentVideoNode) return;

              if (_event.duration < 100)  // the active duration is somehow wrong
                currentVideoNode.activeDuration = (new Date(_event.time)).getTime() - currentVideoStartTime.getTime();
              else
                currentVideoNode.activeDuration = _event.duration;
              currentVideoNode.playedIntervals[currentVideoNode.playedIntervals.length-1].end = videoDuration[_event.target1];
              currentVideoID = '';
            } else if (_event.action == 'video_pause') {

              if (currentVideoID !=  _event.target1) { // new video node, if the video is paused on start
                currentVideoID = _event.target1;
                currentVideoPlayTime = Number(_event.target2);
                currentVideoStartTime = new Date(_event.time);
                currentVideoNode = new Object();
                currentVideoNode.activeDuration = 0;
                currentVideoNode.playedIntervals = [];
                currentVideoNode.pauses = [];

                currentVideoNode.playedIntervals.push({start:currentVideoPlayTime, end:null});

                if (!currentActivityNode.videos[currentVideoID])
                  currentActivityNode.videos[currentVideoID] = [];
                currentActivityNode.videos[currentVideoID].push(currentVideoNode);

              }

              var pauseNode = new Object();
              pauseNode.start = new Date(_event.time);
              pauseNode.end = null;
              pauseNode.at = Number(_event.target2);
              currentVideoNode.pauses.push(pauseNode);

            // } else if (_event.action == 'video_replay') {
            //   if (currentVideoID !=''){ // by any chance that the video didn't end properly
            //   }

            } else if (_event.action == 'video_stop') {
              if (currentVideoID != '') { // video_end didn't fire
                currentVideoNode.activeDuration = (new Date(_event.time)).getTime() - currentVideoStartTime.getTime();
                currentVideoNode.playedIntervals[currentVideoNode.playedIntervals.length-1].end = videoDuration[_event.target1];
                currentVideoID = '';
              }

            // } else if (_event.action == 'video_select') {
            // } else if (_event.action == 'video_next_phase') {

            }

            return;
          }

          if (_event.actionType == 'end') {
            activityEnd = new Date(_event.time);

            // by any change there is no end indicator for video
            if (currentVideoID != '') {
              currentVideoNode.activeDuration = (new Date(_event.time)).getTime() - currentVideoStartTime.getTime();

              if (currentVideoNode.playedIntervals.length > 0 && currentVideoNode.playedIntervals[currentVideoNode.playedIntervals.length-1].end == null)
                currentVideoNode.playedIntervals[currentVideoNode.playedIntervals.length-1].end = videoDuration[currentVideoID];
              if (currentVideoNode.pauses.length > 0 && currentVideoNode.pauses[currentVideoNode.pauses.length-1].end == null) // don't need to check for pause end for the "video_end" and "video_stop" as there won't be cases that video is being paused while the two events are triggered
                currentVideoNode.pauses[currentVideoNode.pauses.length-1].end = new Date(_event.time);

              currentVideoID = '';
            }
          }

        });
        // end of events

        // by any chance there is no end
        if (activityEnd == null) {
          activityEnd = currentEventTimeStamp;
        }

        currentActivityNode.start = activityStart;
        currentActivityNode.end = activityEnd;
        currentActivityNode.duration = activityEnd.getTime() - activityStart.getTime();

        // further summary for the currentActivityNode
        // video
        for (var videoID in currentActivityNode.videos) {
          var videoNode = currentActivityNode.videos[videoID];

          tempPlayedInterval = [];
          // this videoNode is for the video(sum of multiple play times)
          videoNode.pauses = [];
          videoNode.activeDuration = 0;

          for (var i = 0; i<videoNode.length; i++) {
            var video = videoNode[i];
            video.consolidatedIntervals = unionPlayedVideoIntervals(video.playedIntervals);
            video.watchedPercentage = video.consolidatedIntervals.playedLength/videoDuration[videoID];
            if (video.watchedPercentage > 0.99)
              video.watchedPercentage = 1;
            tempPlayedInterval.push.apply(tempPlayedInterval, video.consolidatedIntervals.intervals);
            videoNode.pauses.push.apply(videoNode.pauses, video.pauses);
            videoNode.activeDuration += video.activeDuration;
          }
          
          videoNode.watchedIntervals = unionPlayedVideoIntervals(tempPlayedInterval);
          videoNode.watchedPercentage = videoNode.watchedIntervals.playedLength / videoDuration[videoID];
          if (videoNode.watchedPercentage > 0.99)
            videoNode.watchedPercentage = 1;
        }

      });
      // end of activities

      //summarize session node
      currentSessionNode.start = currentSessionNode.activities[0].start;
      currentSessionNode.end = currentSessionNode.activities[currentSessionNode.activities.length-1].end;
      currentSessionNode.duration = currentSessionNode.end.getTime() - currentSessionNode.start.getTime();
      currentSessionNode.offTask = new Object();
      currentSessionNode.offTask.instances = [];
      currentSessionNode.offTask.duration = 0;
      //currentSessionNode.activities = new Object();
      currentSessionNode.mcqs = new Object();
      currentSessionNode.videos = new Object();

      for (var i = 0; i<currentSessionNode.activities.length; i++) {
        // offTask
        Array.prototype.push.apply(currentSessionNode.offTask.instances, currentSessionNode.activities[i].offTask.instances);
        currentSessionNode.offTask.duration += currentSessionNode.activities[i].offTask.totalduration;

        //video
        for (var videoID in currentSessionNode.activities[i].videos) {
          if (!currentSessionNode.videos[videoID]) {
            currentSessionNode.videos[videoID] = new Object();
            currentSessionNode.videos[videoID].activeDuration = 0;
            currentSessionNode.videos[videoID].pauseTimes = 0;
            currentSessionNode.videos[videoID].pauseDuration = 0;
            currentSessionNode.videos[videoID].watchedIntervals = new Object();
            currentSessionNode.videos[videoID].watchedIntervals.rawIntervals = [];
            currentSessionNode.videos[videoID].watchedPercentage = 0;
          }

          var childVideoNode = currentSessionNode.activities[i].videos[videoID];
          currentSessionNode.videos[videoID].activeDuration += childVideoNode.activeDuration;
          currentSessionNode.videos[videoID].pauseTimes += childVideoNode.pauses.length;
          for (var j = 0; j<childVideoNode.pauses.length; j++) {
            if (childVideoNode.pauses[j].end) // sometimes there is no end for the pause
              currentSessionNode.videos[videoID].pauseDuration += childVideoNode.pauses[j].end.getTime() - childVideoNode.pauses[j].start.getTime();
          }
          if (childVideoNode.watchedPercentage > 0.99) {
            currentSessionNode.videos[videoID].watchedPercentage = 1;
          } else {
            Array.prototype.push.apply(currentSessionNode.videos[videoID].watchedIntervals.rawIntervals, childVideoNode.watchedIntervals.intervals);
          }

        }

        // further video summary
        for (var videoID in currentSessionNode.videos) {
          if (currentSessionNode.videos[videoID].watchedIntervals.rawIntervals
            && (currentSessionNode.videos[videoID].watchedPercentage >= 1 
              || currentSessionNode.videos[videoID].watchedIntervals.rawIntervals.length == 0)) continue;
          currentSessionNode.videos[videoID].watchedIntervals = unionPlayedVideoIntervals(currentSessionNode.videos[videoID].watchedIntervals.rawIntervals);
          currentSessionNode.videos[videoID].watchedPercentage = currentSessionNode.videos[videoID].watchedIntervals.playedLength / videoDuration[videoID];
          if (currentSessionNode.videos[videoID].watchedPercentage > 0.99)
            currentSessionNode.videos[videoID].watchedPercentage = 1;  
        }

      }

    });
    // end of sessions

    currentSubjectNode.duration = 0;
    currentSubjectNode.offTask = new Object();
    currentSubjectNode.offTask.instances = [];
    currentSubjectNode.offTask.duration = 0;
    currentSubjectNode.mcqs = new Object();
    currentSubjectNode.videos = new Object();
    for (var i_ssn = 0; i_ssn < currentSubjectNode.sessions.length; i_ssn++) {
      currentSubjectNode.duration += currentSubjectNode.sessions[i_ssn].duration;
      Array.prototype.push.apply(currentSubjectNode.offTask.instances, currentSubjectNode.sessions[i_ssn].offTask.instances);
      currentSubjectNode.offTask.duration += currentSubjectNode.sessions[i_ssn].offTask.duration;

      for (var videoID in currentSubjectNode.sessions[i_ssn].videos) {
        if (!currentSubjectNode.videos[videoID]) {
          currentSubjectNode.videos[videoID] = new Object();
          currentSubjectNode.videos[videoID].activeDuration = 0;
          currentSubjectNode.videos[videoID].pauseTimes = 0;
          currentSubjectNode.videos[videoID].pauseDuration = 0;
          currentSubjectNode.videos[videoID].watchedIntervals = new Object();
          currentSubjectNode.videos[videoID].watchedIntervals.rawIntervals = [];
          currentSubjectNode.videos[videoID].watchedPercentage = 0;
        }

        var childVideoNode = currentSubjectNode.sessions[i_ssn].videos[videoID];
        currentSubjectNode.videos[videoID].activeDuration += childVideoNode.activeDuration;
        currentSubjectNode.videos[videoID].pauseTimes += childVideoNode.pauseTimes;
        currentSubjectNode.videos[videoID].pauseDuration += childVideoNode.pauseDuration;
        if (childVideoNode.watchedPercentage > 0.99) {
          currentSubjectNode.videos[videoID].watchedPercentage = 1;
        } else {
          Array.prototype.push.apply(currentSubjectNode.videos[videoID].watchedIntervals.rawIntervals, childVideoNode.watchedIntervals.intervals);
        }
      }

      for (var videoID in currentSubjectNode.videos) {
        if (currentSubjectNode.videos[videoID].watchedIntervals.rawIntervals
          && (currentSubjectNode.videos[videoID].watchedPercentage >= 1 
            || currentSubjectNode.videos[videoID].watchedIntervals.rawIntervals.length < 1))
          continue;
        currentSubjectNode.videos[videoID].watchedIntervals = unionPlayedVideoIntervals(currentSubjectNode.videos[videoID].watchedIntervals.rawIntervals);
        currentSubjectNode.videos[videoID].watchedPercentage = currentSubjectNode.videos[videoID].watchedIntervals.playedLength / videoDuration[videoID];
        if (currentSubjectNode.videos[videoID].watchedPercentage > 0.99)
          currentSubjectNode.videos[videoID].watchedPercentage = 1;
      }
    }
  });
  // end of subjects
}

function unionPlayedVideoIntervals(intervals) {
  if (intervals == undefined)
    return {'rawIntervals':intervals, 'playedLength':0, 'intervals':[]};
  var mergedIntervals = intervals;
  var mergedLength = -1;
  var key = 0;
  do {
    mergedLength = mergedIntervals.length;
    mergedIntervals = unionIntervals(mergedIntervals, key);
    key++;
  } while (mergedIntervals.length != mergedLength && mergedIntervals.length > key);

  var playedLength = 0;
  for (var i = 0; i<mergedIntervals.length; i++) {
    playedLength += mergedIntervals[i].end - mergedIntervals[i].start;
  }

  return {'rawIntervals':intervals, 'playedLength':playedLength, 'intervals':mergedIntervals};
}

function unionIntervals(intervals, key) {
  var mergedIntervals = [];

  for (var i = 0; i<=key; i++) {
    mergedIntervals.push(intervals[i]);
  }

  for (var i = key+1; i< intervals.length; i++) {
    // merge mergedIntervals[0] and intervals[i]
    if (mergedIntervals[key].end < intervals[i].start || mergedIntervals[key].start > intervals.end) { // cannot merge
      mergedIntervals.push(intervals[i]);
    } else {
      mergedIntervals[key].start = mergedIntervals[key].start < intervals[i].start ? mergedIntervals[key].start : intervals[i].start;
      mergedIntervals[key].end   = mergedIntervals[key].end   > intervals[i].end   ? mergedIntervals[key].end   : intervals[i].end  ;     
    }
  }

  return mergedIntervals;
}

// function getVideoDuration(id) {
//   https.get('https://www.googleapis.com/youtube/v3/videos?id='+id+'&key=AIzaSyCghq5LFS4EhzNMJejenup1ZQO6xiNRMtY&part=contentDetails', function(res) {
//     res.on('data', function(d) {
//       var reptms = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
//       var hours = 0, minutes = 0, seconds = 0, totalseconds;
//       if (reptms.test( JSON.parse(d.toString()).items[0].contentDetails.duration )) {
//         var matches = reptms.exec(input);
//         if (matches[1]) hours = Number(matches[1]);
//         if (matches[2]) minutes = Number(matches[2]);
//         if (matches[3]) seconds = Number(matches[3]);
//         totalseconds = hours * 3600  + minutes * 60 + seconds;
//       }
//     });
//   }).on('error', function(e) {
//     console.error(e);
//   });
// }

function sendResponse(res) {
  if (_response == null) {
    console.error('response is null');
  }

  _response.writeHead(200, {"Content-Type": "application/json"});
  if ( (typeof res) == 'string')
    _response.end(res);
  else
    _response.end( JSON.stringify(res) );
}

var _response = null;

server = http.createServer(function(request, response) {
  _response = response;
  parsedUrl = url.parse(request.url, true);
  resource = routes[parsedUrl.pathname];
  if (resource) {
    resource(parsedUrl);
    // response.writeHead(200, {"Content-Type": "application/json"});
    // response.end(JSON.stringify(resource(parsedUrl)));
  }
  else {
    response.writeHead(404);
    _response.end();
  }
});
server.listen(1337,'127.0.0.1');
console.log('running');