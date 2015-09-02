var http = require('http');
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
var questions;

// mapping phaseID to phaseTry in the DB
var palmviewActivityMapper = {};
palmviewActivityMapper[16] = 1;
palmviewActivityMapper[17] = 2;
palmviewActivityMapper[18] = 3;
palmviewActivityMapper[19] = 4;
palmviewActivityMapper[20] = 5;
palmviewActivityMapper[24] = 6;
palmviewActivityMapper[25] = 7;
palmviewActivityMapper[26] = 8;
palmviewActivityMapper[27] = 9;
var activityMapper = {};
activityMapper[2] = palmviewActivityMapper;

var node_to_exclude = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 131, 132];

var routes = {
  // calculate the values across questions
  "/api/initialize": function() {
    operational = storage.getItemSync('operational');
    if (!operational) {
      operational = {};
      operational.schools = [];
      operational.classes = [];
      operational.students = [];
      storage.setItemSync('operational', operational);
      questions = {};
      storage.setItemSync('questions', questions);
      sendResponse('initialized!');
      return;
    }

    questions = storage.getItemSync('questions');
    sendResponse('loaded!');
  },
  // create student nodes
  "/api/createnode": function(parsedUrl) {
    if (!operational) {
      console.error('initialize first!');
    }

    var studentID = parsedUrl.query.studentID;
    var schoolID = parsedUrl.query.school;

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
                       'WHERE s.studentID = '+studentID+';',
                      student_query_handler);
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
                       'WHERE s.schoolID = ' +schoolID+ ';',
                       student_query_handler); 
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
                       'WHERE 1;',
                       student_query_handler);
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
          //studentNode = {};
          //storage.setItemSync('student_'+row.studentID, studentNode);
        //}
        if (node_to_exclude.indexOf(row.studentID) > -1) {
          return;
        }

        var studentNode = {};

        var exclude = ['subjID', 'subjName', 'progress'];

        for (var attr in row) {
          if ( exclude.indexOf(attr) < 0 ) {
            studentNode[attr] = row[attr];
          }
        }
        
        if (!studentNode.subjects) {
          studentNode.subjects = {};
        }
        if (!studentNode.subjects[row.subjID]){
          studentNode.subjects[row.subjID] = {};
        }

        studentNode.subjects[row.subjID].name = row.subjName;
        studentNode.subjects[row.subjID].progress = row.progress;

        if (operational.students.indexOf(studentNode.studentID) < 0) {
          operational.students.push(studentNode.studentID);
        }
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
    var studentID = parsedUrl.query.studentID;
    var sessionID = parsedUrl.query.sessionID;
    
    if (!studentID) { // rebuild the log for all the students !!!! set to process palmview's data first
      connection.query( 'SELECT LOG.time, LOG.duration, LOG.actionType, LOG.action, LOG.target1, LOG.target2, LOG.phaseID, LOG.correct, LOG.studentID, LOG.sessionID FROM LOG INNER JOIN STUDENT ON  `LOG`.studentID =  `STUDENT`.studentID AND  '+
        '`STUDENT`.schoolID = 2 ORDER BY  `LOG`.studentID,  `LOG`.`logID`',
        log_query_handler);
    } else if (!sessionID) {  // (re)build the log for the student with studentID
      connection.query('SELECT time, duration, actionType, action, target1, target2, phaseID, correct, studentID, sessionID FROM `LOG` WHERE studentID = '+studentID+' ORDER BY `logID`',
        log_query_handler);
    } else {  // (re)build a session
      connection.query('SELECT time, duration, actionType, action, target1, target2, phaseID, correct, studentID, sessionID FROM `LOG` WHERE studentID = '+studentID+' AND sessionID = '+sessionID+' ORDER BY `logID`',
        log_query_handler);
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

      rows.forEach(function(row){
        if (node_to_exclude.indexOf(row.studentID) > -1) {
          return;
        }

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

          if (!currentStudentNode.subjects[Object.keys(currentStudentNode.subjects)[0]].sessions) {
            currentStudentNode.subjects[Object.keys(currentStudentNode.subjects)[0]].sessions = [];
          }
        }

        if (row.sessionID != currentSessionID) {
          currentSessionID = row.sessionID;
          currentSessionNode = {};
          currentSessionNode.sessionID = currentSessionID;
          currentSessionNode.activities = [];
          currentStudentNode.subjects[Object.keys(currentStudentNode.subjects)[0]].sessions.push(currentSessionNode);

          currentActivityID = null;
          currentActivityNode = null;
        }

        if (row.phaseID != currentActivityID) {
          currentActivityID = row.phaseID;
          currentActivityNode = {};
          currentActivityNode.activityID = activityMapper[2][currentActivityID];
          currentActivityNode.events = [];
          currentSessionNode.activities.push(currentActivityNode);
        }

        var eventNode = {};
        eventNode.time = row.time;
        eventNode.duration = row.duration;
        eventNode.actionType = row.actionType;
        eventNode.action = row.action;
        eventNode.target1 = row.target1;
        eventNode.target2 = row.target2;
        eventNode.correct = !row.correct; // bit operation, if row.correct = [0], then !row.correct = false

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
  "/api/processlog": function(parsedUrl) {
    var studentID = parsedUrl.query.studentID;
    var sessionID = parsedUrl.query.sessionID;
    
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
    sendResponse('done!');
  },
  // query to the log of the database and consolidate it into student node
  "/api/parsequestion": function(parsedUrl) {
    
    connection.query( 'SELECT * FROM `QUESTIONDB` WHERE `subjID`=2 ORDER BY `QUESTIONDB`.`qID` ASC',
      question_query_handler);

    function question_query_handler(err, rows) {
      if (err) {
        console.error('error connecting: ' + err.stack);
        return;
      }

      if (!rows || rows.length < 1) {
        console.log('no question');
        return;
      }

      var questions;
      questions = storage.getItemSync('questions');
      if (!questions)
        throw "no questions!!!";

      rows.forEach(function(qns){
        var questionNode = {};
        questionNode.id = qns.qID;
        questionNode.type = qns.qnsType;
        questionNode.content = qns.qns;
        questionNode.answer = qns.ans;
        questionNode.para1 = qns.opt1;
        questionNode.para2 = qns.opt2;
        questionNode.para3 = qns.opt3;
        questionNode.para4 = qns.opt4;

        questions[questionNode.id] = questionNode;
      });

      storage.setItemSync('questions', questions);

      sendResponse('done!');
    }
  },
  // // calculate the values across cohort
  // "/api/macro": function(parsedUrl) {
  //   return {unixtime: (new Date(parsedUrl.query.iso)).getTime()};
  // },
  // // calculate the values across questions
  // "/api/questions": function(parsedUrl) {
  //   return {unixtime: (new Date(parsedUrl.query.iso)).getTime()};
  // },
  // retrive student node
  "/api/retrieve": function(parsedUrl) {
    var studentID = parsedUrl.query.studentID;
    var schoolID = parsedUrl.query.schoolID;
    var studentNode, students, i;

    if(studentID) {
      studentNode = storage.getItemSync('student_'+studentID);
      if (studentNode) {
        sendResponse(JSON.stringify(studentNode));
      } else {
        sendResponse("no student with id: "+studentID);
      }
    } else if(schoolID){
      students = [];
      for(i = 0; i< operational.students.length; i++) {
        studentNode = storage.getItemSync('student_'+operational.students[i]);
        if (!studentNode || studentNode.schoolID != schoolID) {
          continue;
        }
        students.push(studentNode);
      }
      sendResponse(JSON.stringify(students));
    } else {
      students = [];
      for(i = 0; i< operational.students.length; i++) {
        studentNode = storage.getItemSync('student_'+operational.students[i]);
        if (!studentNode) {
          continue;
        }
        students.push(studentNode);
      }
      sendResponse(JSON.stringify(students));
    }

    return {};
  },
  "/api/clear": function() {
    storage.clearSync();
    sendResponse('done!');
  }
};

var currentSubjectNode;
var currentSessionNode;
var currentActivityNode;
var activityStart;
var activityEnd;
var currentEventTimeStamp;

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
    if (currentSubjectNode.progress <= 1) {
      return;
    }
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

        currentActivityNode.offTask = {};
        currentActivityNode.offTask.instances = [];
        currentActivityNode.offTask.totalduration = 0;
        var offTaskIndex = -1;

        currentActivityNode.videos = {};
        var currentVideoNode = null;
        var currentVideoID = '';
        var currentVideoPlayTime = 0;
        var currentVideoStartTime = 0;
        var previousPlayTime = 0;
        var previousStartTime = 0;

        currentActivityNode.questions = [];
        var currentQuestionNode = null;
        var currentQuestionID = '';
        var currentQuestionReadNode = null; // read node is special as there is no action that actually logged for this period. the only practice is that after starting a question, until the first action is made, is the reading period
        var currentQuestionSelectedOperator = '';

        var tailNode;
        var sequenceNode;

        currentActivityNode.events.forEach(function(_event){
          currentEventTimeStamp = new Date(_event.time);
          // general 
          if (_event.actionType == 'start') {
            activityStart = new Date(_event.time);
            return;
          }

          if (activityStart === null) {
            activityStart = currentEventTimeStamp;
          }

          // with parent check
          if (_event.action == 'with_parent') {
            currentSessionNode.withParent = (_event.target1 == 'true');
            return;
          }

          if (_event.actionType == 'pageActivity') {
            if (_event.action == 'leave_page') {
              offTaskIndex ++;
              currentActivityNode.offTask.instances[offTaskIndex] = {};
              currentActivityNode.offTask.instances[offTaskIndex].startTime = new Date(_event.time);
              currentActivityNode.offTask.instances[offTaskIndex].duration = -1;
            } else if (_event.action == 'alt_page') {
              if (offTaskIndex < 0 || currentActivityNode.offTask.instances[offTaskIndex].duration >= 0) {
                offTaskIndex ++;
                currentActivityNode.offTask.instances[offTaskIndex] = {};
                currentActivityNode.offTask.instances[offTaskIndex].startTime = new Date(_event.time - _event.duration);
              }
              currentActivityNode.offTask.instances[offTaskIndex].duration = _event.duration;
              currentActivityNode.offTask.totalduration += _event.duration;
            }
            return;
          }

          // all the video stuff comes here
          if (_event.actionType == "mouseClick" && startWith(_event.action, "video_") ) {
            if (_event.action == 'video_start') {
              if (currentVideoID !=  _event.target1) { // new video play
                currentVideoID = _event.target1;
                currentVideoPlayTime = Number(_event.target2);
                currentVideoStartTime = new Date(_event.time);
                currentVideoNode = {};
                currentVideoNode.activeDuration = 0;
                currentVideoNode.playedIntervals = [];
                currentVideoNode.pauses = [];

                currentVideoNode.playedIntervals.push({start:currentVideoPlayTime, end:null});

                if (!currentActivityNode.videos[currentVideoID]) {
                  currentActivityNode.videos[currentVideoID] = [];
                }
                currentActivityNode.videos[currentVideoID].push(currentVideoNode);

              } else { // seek to another location/pause then resume
                currentVideoPlayTime = Number(_event.target2);
                
                if (currentVideoNode.playedIntervals[currentVideoNode.playedIntervals.length-1].end === null) { // calculate previous played interval
                  currentVideoNode.playedIntervals[currentVideoNode.playedIntervals.length-1].end = previousPlayTime + ((new Date(_event.time)).getTime() - previousStartTime.getTime())/1000 ;
                }

                currentVideoNode.playedIntervals.push({start:currentVideoPlayTime, end:null});

                // if it is a resume after pause
                if (currentVideoNode.pauses.length > 0 && currentVideoNode.pauses[currentVideoNode.pauses.length-1].end === null)
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
                currentVideoNode = {};
                currentVideoNode.activeDuration = 0;
                currentVideoNode.playedIntervals = [];
                currentVideoNode.pauses = [];

                currentVideoNode.playedIntervals.push({start:currentVideoPlayTime, end:null});

                if (!currentActivityNode.videos[currentVideoID])
                  currentActivityNode.videos[currentVideoID] = [];
                currentActivityNode.videos[currentVideoID].push(currentVideoNode);

              }

              var pauseNode = {};
              pauseNode.start = new Date(_event.time);
              pauseNode.end = null;
              pauseNode.at = Number(_event.target2);
              currentVideoNode.pauses.push(pauseNode);

            // } else if (_event.action == 'video_replay') {
            //   if (currentVideoID !=''){ // by any chance that the video didn't end properly
            //   }

            } else if (_event.action == 'video_stop') {
              if (currentVideoID !== '') { // video_end didn't fire
                currentVideoNode.activeDuration = (new Date(_event.time)).getTime() - currentVideoStartTime.getTime();
                currentVideoNode.playedIntervals[currentVideoNode.playedIntervals.length-1].end = videoDuration[_event.target1];
                currentVideoID = '';
              }

            // } else if (_event.action == 'video_select') {
            // } else if (_event.action == 'video_next_phase') {

            }

            return;
          } // end of video events

          if (currentActivityNode.activityID == 5 && _event.action == 'qnsStart') {
             // identical with line below
            if (currentQuestionID !== '') { // there is a question node exist, can do some statistics here
              currentQuestionNode.endTime = new Date(_event.time);
              currentQuestionNode.duration = currentQuestionNode.endTime.getTime() - currentQuestionNode.startTime.getTime();
              currentQuestionID = '';
              if (currentQuestionReadNode) {
                currentQuestionReadNode.endTime = new Date(_event.time);
                currentQuestionReadNode.duration = currentQuestionReadNode.endTime.getTime() - currentQuestionReadNode.startTime.getTime();
                currentQuestionNode.sequence.push(currentQuestionReadNode);
                currentQuestionReadNode = null;
              }
            }
            return;
          }

          // ----------------- questions ----------------- //
          if (currentQuestionID == 'temp' &&
            !startWith(_event.action, "instruction_") &&
            !startWith(_event.action, "select_well-done") &&
            _event.action != 'start_step' ) {
            currentQuestionID = _event.target1;
            currentQuestionNode.id = currentQuestionID;
          }

          // new question
          if ((currentQuestionID != _event.target1 &&         // to check for questionID rather than use 'qnsStart', the reason is that 'qnsStart' might not exist
            !startWith(_event.action, "instruction_") &&    // these are the stupid ones that don't have the questionID
            !startWith(_event.action, "select_well-done") &&
            (_event.action != 'start_step') || (_event.action == 'start_step' && currentQuestionID === '')) ) {
            
            if (currentQuestionID !== '') { // there is a question node exist, can do some statistics here
              currentQuestionNode.endTime = new Date(_event.time);
              currentQuestionNode.duration = currentQuestionNode.endTime.getTime() - currentQuestionNode.startTime.getTime();
              currentQuestionID = '';
              if (currentQuestionReadNode) { // identical with line 533 !!!!!!!!!!!!!
                currentQuestionReadNode.endTime = new Date(_event.time);
                currentQuestionReadNode.duration = currentQuestionReadNode.endTime.getTime() - currentQuestionReadNode.startTime.getTime();
                currentQuestionNode.sequence.push(currentQuestionReadNode);
                currentQuestionReadNode = null;
              }
            }

            if (_event.action == 'start_step' && _event.target1 == '0') {
              currentQuestionID = 'temp';
            } else {
              currentQuestionID = _event.target1;
            }
            currentQuestionNode = {};
            currentQuestionNode.id = currentQuestionID;
            currentQuestionNode.startTime = new Date(_event.time);
            currentQuestionNode.sequence = [];
            currentQuestionReadNode = {};
            currentQuestionReadNode.label = 'R';
            currentQuestionReadNode.startTime = new Date(_event.time);
            currentQuestionReadNode.endTime = null;

            currentActivityNode.questions.push(currentQuestionNode);
          }

          // pattern labels:
          // V  - instruction video
          // S  - start
          // R  - read
          // I  - identify
          // G  - get a plan
          // H  - have it done
          // T  - triple check
          // A  - write/choose an answer but haven't commit
          // AC - submit answer correctly
          // AW - submit answer wrongly
          // !!! don't have CA - correct and progress to next activity
          // !!! don't have CP - correct and go to next question
          // CM - practive more on this activity
          // WR - wrong and retry
          // WH - wrong and want hint
          // WI - wrong and ignore
          // L, LR, LI, LG, LH, LT : click on the checklist

          if (_event.action == 'qnsStart') {
            sequenceNode = {};
            sequenceNode.label = 'S';
            sequenceNode.time = new Date(_event.time);
            currentQuestionNode.sequence.push(sequenceNode);
            sequenceNode = null;
            return;
          }

          if (currentQuestionReadNode) { // got identical code above
            currentQuestionReadNode.endTime = new Date(_event.time);
            currentQuestionReadNode.duration = currentQuestionReadNode.endTime.getTime() - currentQuestionReadNode.startTime.getTime();
            currentQuestionNode.sequence.push(currentQuestionReadNode);
            currentQuestionReadNode = null;
          }

          // watched the instruction video for the activity
          // it is logged after the qnsStart, but actually should be before
          // manually change it here
          if (startWith(_event.action, "instruction_")) {
            var lastNode = currentQuestionNode.sequence.pop();
            sequenceNode = {};
            sequenceNode.label = 'V';

            if (lastNode.label == 'S') {
              sequenceNode.time = lastNode.time;
              lastNode.time = new Date(_event.time);
              sequenceNode.duration = sequenceNode.time.getTime() - lastNode.time.getTime();
              currentSubjectNode.sequence.push(sequenceNode);
              currentSubjectNode.sequence.push(lastNode);
            } else {
              currentQuestionNode.sequence.push(lastNode);
              sequenceNode.time = new Date(_event.time);
              currentQuestionNode.sequence.push(sequenceNode);
            }
            sequenceNode = null;
            return;
          }

          if ((startWith(_event.action, 'progress_') ||
            _event.action == 'start_step')) {

            sequenceNode = {};
            sequenceNode.time = new Date(_event.time);

            if (_event.action == 'start_step') {
              switch (_event.target1) {
                // case '0':
                //   break;
                case '1':
                  sequenceNode.label = 'LR';
                  break;
                case '2':
                  sequenceNode.label = 'LI';
                  break;
                case '3':
                  sequenceNode.label = 'LG';
                  break;
                case '4':
                  sequenceNode.label = 'LH';
                  break;
                case '5':
                  sequenceNode.label = 'LT';
                  break;
              }
            } else {
              sequenceNode.label = 'L';
            }

            currentQuestionNode.sequence.push(sequenceNode);
            sequenceNode = null;
            return;
          }

          if (_event.action == 'highlight' || _event.action == 'de-highlight') {
            tailNode = currentQuestionNode.sequence[currentQuestionNode.sequence.length-1];
            if (tailNode.label == 'I') { // append the current event to it
              tailNode.highlightedWords.push({time:new Date(_event.time), word:_event.target2, highlight: _event.action == 'highlight'});
            } else {
              if (tailNode.startTime && typeof tailNode.endTime == 'object' && !tailNode.endTime) { // properly complete the last node
                tailNode.endTime = new Date(_event.time);
                tailNode.duration = tailNode.endTime.getTime() - tailNode.startTime.getTime();
              }
              // create new node and push to sequence
              sequenceNode = {};
              sequenceNode.label = 'I';
              sequenceNode.startTime = new Date(_event.time);
              sequenceNode.endTime = null;
              sequenceNode.highlightedWords = [];
              sequenceNode.highlightedWords.push({time:new Date(_event.time), word:_event.target2, highlight: _event.action == 'highlight'});
              currentQuestionNode.sequence.push(sequenceNode);
              sequenceNode = null;
            }
            
            tailNode = null;
            return;
          }

          // get plan events
          if (startWith(_event.action, 'select_modal') ) {
            tailNode = currentQuestionNode.sequence[currentQuestionNode.sequence.length-1];
            if (tailNode.label != 'G') {
              if (tailNode.startTime && typeof tailNode.endTime == 'object' && !tailNode.endTime) {
                tailNode.endTime = new Date(_event.time);
                tailNode.duration = tailNode.endTime.getTime() - tailNode.startTime.getTime();
              }

              sequenceNode = {};
              sequenceNode.label = 'G';
              sequenceNode.startTime = new Date(_event.time);
              sequenceNode.endTime = null;
              sequenceNode.select_type = ['addition'];
              sequenceNode.select_model = [];
              sequenceNode.selectedModel = null;

              currentQuestionNode.sequence.push(sequenceNode);
              tailNode = sequenceNode;
              sequenceNode = null;
            }

            if (_event.action == 'select_modal') {
              tailNode = null;
              return;
            }

            if (tailNode.label != 'G') {
              throw "WTF???";
              // console.log('missing select_modal !!!' + _event.actionType + ' ' + _event.action);
              // return;
            }

            if (startWith(_event.action, 'select_modal_choose_type')) {
              tailNode.select_type.push(_event.action.substr(25));
              tailNode = null;
              return;
            }

            if (startWith(_event.action, 'select_modal_click')) {
              tailNode.select_model.push(_event.action.substr(25));
              tailNode = null;
              return;
            }

            if (startWith(_event.action, 'select_modal_complete')) {
              tailNode.endTime = new Date(_event.time);
              tailNode.duration = tailNode.endTime.getTime() - tailNode.startTime.getTime();
              tailNode.selectedModel = _event.action.substr(28);
              switch (tailNode.selectedModel.substr(0, 1)) {
                case 'A':
                  currentQuestionSelectedOperator = '+';
                  break;
                case 'S':
                  currentQuestionSelectedOperator = '-';
                  break;
                case 'M':
                  currentQuestionSelectedOperator = '*';
                  break;
                case 'D':
                  currentQuestionSelectedOperator = '/';
                  break;
                default:
                  throw 'What?? I dont know this ' + tailNode.selectedModel;
              }
              tailNode = null;
              return;
            }

            if (startWith(_event.action, 'select_modal_cancel')) {
              tailNode = null;
              return;
            }

            throw 'what? have more select_modal??? '+_event.actionType + ' ' + _event.action + ' ' + _event.target1;

          }

          // have it done event
          if (_event.action == 'drag' ||
            _event.action == 'drop' ||
            _event.action == 'label' ||
            startWith(_event.action, 'equation_')) {

            tailNode = currentQuestionNode.sequence[currentQuestionNode.sequence.length-1];
            if (tailNode.label != 'H') {
              if (tailNode.startTime && typeof tailNode.endTime == 'object' && !tailNode.endTime) { // properly close the previous phase
                tailNode.endTime = new Date(_event.time);
                tailNode.duration = tailNode.endTime.getTime() - tailNode.startTime.getTime();
              }
              sequenceNode = {};
              sequenceNode.label = 'H';
              sequenceNode.startTime = new Date(_event.time);
              sequenceNode.endTime = null;
              sequenceNode.dragDrops = [];
              sequenceNode.labels = [];
              sequenceNode.equationElements = [];
              currentQuestionNode.sequence.push(sequenceNode);
              sequenceNode = null;
            }
            sequenceNode = currentQuestionNode.sequence[currentQuestionNode.sequence.length-1];
            if (_event.action == 'drag') {
              sequenceNode.dragDrops.push('drag_'+_event.target2);
            } else if (_event.action == 'drop') {
              sequenceNode.dragDrops.push('drop_'+_event.target2+'_'+_event.correct);
            } else if (_event.action == 'label') {
              sequenceNode.labels.push(_event.correct);
            } else if (_event.action.length > 9) { // filtered out some stupid equation_ entries
              sequenceNode.equationElements.push(_event.action.substr(9)+'_'+_event.correct);
            } else {
              if (_event.action == 'equation_') {
                return;
              }
              throw 'what? still have???' + _event.actionType + ' ' + _event.action + ' ' + _event.target1;
            }

            sequenceNode = null;
            tailNode = null;
            return;
          }

          if (_event.action == 'mcq_select' || _event.action == 'answer') {
            tailNode = currentQuestionNode.sequence[currentQuestionNode.sequence.length-1];
            if (tailNode.label != 'A') {
              if (tailNode.startTime && typeof tailNode.endTime == 'object' && !tailNode.endTime) {
                tailNode.endTime = new Date(_event.time);
                tailNode.duration = tailNode.endTime.getTime() - tailNode.startTime.getTime();
              }
              sequenceNode = {};
              sequenceNode.label = 'A';
              sequenceNode.startTime = new Date(_event.time);
              sequenceNode.endTime = null;
              sequenceNode.answers = [];
              currentQuestionNode.sequence.push(sequenceNode);
              sequenceNode = null;
            }
            sequenceNode = currentQuestionNode.sequence[currentQuestionNode.sequence.length-1];
            sequenceNode.answers.push(_event.correct);
            sequenceNode = null;
            tailNode = null;
            return;
          }

          if (_event.actionType == 'submission') {
            tailNode = currentQuestionNode.sequence[currentQuestionNode.sequence.length-1];
            if (tailNode.startTime && typeof tailNode.endTime == 'object' && !tailNode.endTime) {
              tailNode.endTime = new Date(_event.time);
              tailNode.duration = tailNode.endTime.getTime() - tailNode.startTime.getTime();
            }

            sequenceNode = {};
            sequenceNode.label = _event.correct ? 'AC' : 'AW';
            if (_event.action == 'tut_equation') {
              var equation = _event.target2;
              equation = equation.replace('Ã·', '/');
              equation = equation.replace(' ', currentQuestionSelectedOperator);
              sequenceNode.equation = equation;
            }
            tailNode = null;
            sequenceNode = null;
            return;
          }

          if (_event.actionType == 'end' && _event.action) { // for all practices, the end is not end of the activity, but the end of one question
            tailNode = currentQuestionNode.sequence[currentQuestionNode.sequence.length-1];
            if (tailNode.startTime && typeof tailNode.endTime == 'object' && !tailNode.endTime) {
              tailNode.endTime = new Date(_event.time);
              tailNode.duration = tailNode.endTime.getTime() - tailNode.startTime.getTime();
            }
            tailNode = null;

            sequenceNode = {};
            sequenceNode.time = new Date(_event.time);
            if (_event.action == 'review') {
              sequenceNode.label = 'WR';
            } else if (_event.action == 'ignore_error') {
              sequenceNode.label = 'WI';
            } else if (_event.action == 'show_hint') {
              sequenceNode.label = 'WH';
            } else {
              throw "what??? stil have end event?";
            }
            currentQuestionNode.sequence.push(sequenceNode);
            sequenceNode = null;
            return;
          }

          if (startWith(_event.action, 'select_well-done')) {
            tailNode = currentQuestionNode.sequence[currentQuestionNode.sequence.length-1];
            if (tailNode.startTime && typeof tailNode.endTime == 'object' && !tailNode.endTime) {
              tailNode.endTime = new Date(_event.time);
              tailNode.duration = tailNode.endTime.getTime() - tailNode.startTime.getTime();
            }
            tailNode = null;

            sequenceNode = {};
            sequenceNode.time = new Date(_event.time);
            if (_event.target1 == 'next activity') {
              sequenceNode.label = 'CA';
            } else if (_event.target1 == 'practice more') {
              sequenceNode.label = 'CM';
            }
            sequenceNode = null;
            return;
          }

          if (_event.actionType == 'end' || _event.actionType == 'stop') { // only for video
            activityEnd = new Date(_event.time);

            // by any change there is no end indicator for video
            if (currentVideoID !== '') {
              currentVideoNode.activeDuration = (new Date(_event.time)).getTime() - currentVideoStartTime.getTime();

              if (currentVideoNode.playedIntervals.length > 0 && currentVideoNode.playedIntervals[currentVideoNode.playedIntervals.length-1].end === null)
                currentVideoNode.playedIntervals[currentVideoNode.playedIntervals.length-1].end = videoDuration[currentVideoID];
              if (currentVideoNode.pauses.length > 0 && currentVideoNode.pauses[currentVideoNode.pauses.length-1].end === null) // don't need to check for pause end for the "video_end" and "video_stop" as there won't be cases that video is being paused while the two events are triggered
                currentVideoNode.pauses[currentVideoNode.pauses.length-1].end = new Date(_event.time);

              currentVideoID = '';
            }

            return;
          }

          throw 'what? still have???'+ _event.actionType + ' ' + _event.action;
        });
        // end of events

        // by any chance there is no end
        if (activityEnd === null) {

          if (currentQuestionNode && currentQuestionNode.sequence) {
            tailNode = currentQuestionNode.sequence[currentQuestionNode.sequence.length-1];
            if (tailNode.startTime && typeof tailNode.endTime == 'object' && !tailNode.endTime) { // properly close the previous phase
              tailNode.endTime = currentEventTimeStamp;
              tailNode.duration = tailNode.endTime.getTime() - tailNode.startTime.getTime();
            }
            tailNode = null;
          }

          activityEnd = currentEventTimeStamp;
        }

        currentActivityNode.start = activityStart;
        currentActivityNode.end = activityEnd;
        currentActivityNode.duration = activityEnd.getTime() - activityStart.getTime();

        // further summary for the currentActivityNode
        // video
        for (var videoID in currentActivityNode.videos) {
          var videoNode = currentActivityNode.videos[videoID];

          var tempPlayedInterval = [];
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

        currentActivityNode.reinforcementTimes = 0;
        currentActivityNode.completed = false;
        currentActivityNode.questionSummary = {};
        currentActivityNode.questionSummary.questionNumber = 0;
        currentActivityNode.questionSummary.duration = 0;
        currentActivityNode.questionSummary.correct = 0;
        currentActivityNode.questionSummary.highlightedWords = 0;
        currentActivityNode.questionSummary.workout_planType = {};
        currentActivityNode.questionSummary.workout_planType.times = 0;
        currentActivityNode.questionSummary.workout_planType.correct = 0;
        currentActivityNode.questionSummary.workout_planType.submitTimes = 0;
        currentActivityNode.questionSummary.workout_planType.correctSubmitTimes = 0;
        currentActivityNode.questionSummary.workout_planModel = {};
        currentActivityNode.questionSummary.workout_planModel.times = 0;
        currentActivityNode.questionSummary.workout_planModel.correct = 0;
        currentActivityNode.questionSummary.workout_planModel.submitTimes = 0;
        currentActivityNode.questionSummary.workout_planModel.correctSubmitTimes = 0;
        currentActivityNode.questionSummary.workout_dragDrops = {};
        currentActivityNode.questionSummary.workout_dragDrops.incomplete_attempts = 0;
        currentActivityNode.questionSummary.workout_dragDrops.complete_attempts = 0;
        currentActivityNode.questionSummary.workout_dragDrops.correct_attampts = 0;
        currentActivityNode.questionSummary.workout_equation = {};
        currentActivityNode.questionSummary.workout_equation.times = 0;
        currentActivityNode.questionSummary.workout_equation.correct = 0;
        currentActivityNode.questionSummary.answer = {};
        currentActivityNode.questionSummary.answer.times = 0;
        currentActivityNode.questionSummary.answer.correct = 0;
        currentActivityNode.questionSummary.answer.submitTimes = 0;
        currentActivityNode.questionSummary.answer.correctSubmitTimes = 0;
        currentActivityNode.questionSummary.wrong_answer_reaction = {};
        currentActivityNode.questionSummary.wrong_answer_reaction.ignore = 0;
        currentActivityNode.questionSummary.wrong_answer_reaction.review = 0;
        currentActivityNode.questionSummary.wrong_answer_reaction.hint = 0;

        // question
        for (var questionIndex = 0; questionIndex < currentActivityNode.questions.length; questionIndex++) {
          var questionNode = currentActivityNode.questions[questionIndex];
          var questionData = questions[questionNode.id];
          if (!questionNode.id && (questionNode.duration <= 0 || !questionNode.duration)) {
            continue;
          }
          // if (!questionData) {
          //   throw ("where is the question?!?! id= " + questionNode.id);
          // }
          if (!questionNode.workout_planType) {
            questionNode.workout_planType = {};
            questionNode.workout_planType.times = 0;
            questionNode.workout_planType.correctTimes = 0;
            questionNode.workout_planType.wrongTimes = 0;
            questionNode.workout_planType.final = null;
          }

          if (!questionNode.workout_planModel) {
            questionNode.workout_planModel = {};
            questionNode.workout_planModel.times = 0;
            questionNode.workout_planModel.correctTimes = 0;
            questionNode.workout_planModel.wrongTimes = 0;
            questionNode.workout_planModel.final = null;
          }

          if (!questionNode.workout_dragDrops) {
            questionNode.workout_dragDrops = {};
          }

          if (!questionNode.workout_label) {
            questionNode.workout_label = {};
            questionNode.workout_label.times = 0;
            questionNode.workout_label.correctTimes = 0;
            questionNode.workout_label.wrongTimes = 0;
            questionNode.workout_label.final = null;
          }

          if (!questionNode.workout_equation) {
            questionNode.workout_equation = {};
          }

          if (!questionNode.answer) {
            questionNode.answer = {};
            questionNode.answer.times = 0;
            questionNode.answer.correctTimes = 0;
            questionNode.answer.wrongTimes = 0;
            questionNode.answer.final = null;
          }

          if (!questionNode.wrong_answer_reaction) {
            questionNode.wrong_answer_reaction = {};
            questionNode.wrong_answer_reaction.ignore = 0;
            questionNode.wrong_answer_reaction.review = 0;
            questionNode.wrong_answer_reaction.hint = 0;
          }

          for (var sequenceIndex = 0; sequenceIndex < questionNode.sequence.length; sequenceIndex++) {
            sequenceNode = questionNode.sequence[sequenceIndex];
            switch(sequenceNode.label) {
              case 'G':
                for (var typeIndex = 0; typeIndex<sequenceNode.select_type.length; typeIndex++){
                  questionNode.workout_planType.times ++;
                  if (questionData.type.substr(6,1).toLowerCase() == sequenceNode.select_type[typeIndex].substr(0,1)) {
                    questionNode.workout_planType.correctTimes ++;
                  } else {
                    questionNode.workout_planType.wrongTimes ++;
                  }
                }
                for (var modelIndex = 0; modelIndex<sequenceNode.select_model.length; modelIndex++){
                  questionNode.workout_planModel.times++;
                  if (questionData.type.substr(6).toLowerCase() == sequenceNode.select_model[modelIndex].toLowerCase()) {
                    questionNode.workout_planModel.correctTimes++;
                  } else {
                    questionNode.workout_planModel.wrongTimes++;
                  }
                }
                if (sequenceNode.selectedModel){
                  questionNode.workout_planType.final = sequenceNode.selectedModel.substr(0,1).toLowerCase();
                  questionNode.workout_planModel.final = sequenceNode.selectedModel;
                }
                break;
              case 'H':
                for (var dragDropIndex = 0; dragDropIndex<sequenceNode.dragDrops.length; dragDropIndex++) {
                  var dragDropObjectName = sequenceNode.dragDrops[dragDropIndex].split('_')[1];
                  var dragDropCase = questionNode.workout_dragDrops[dragDropObjectName];
                  if (!dragDropCase) {
                    dragDropCase = {};
                    dragDropCase.incomplete_attempts = 0;
                    dragDropCase.attempts = {};
                    dragDropCase.attempts.times = 0;
                    dragDropCase.attempts.correctTimes = 0;
                    dragDropCase.attempts.wrongTimes = 0;
                    dragDropCase.attempts.final = null;
                    questionNode.workout_dragDrops[dragDropObjectName] = dragDropCase;
                  }
                  if (sequenceNode.dragDrops[dragDropIndex].indexOf("drag_") === 0) { // it's a drag
                    dragDropCase.incomplete_attempts++;
                  } else {                                                            // it's a drop
                    if (sequenceNode.dragDrops[dragDropIndex-1] && sequenceNode.dragDrops[dragDropIndex-1].indexOf(dragDropObjectName)>0){
                      dragDropCase.incomplete_attempts--;
                    }
                    dragDropCase.attempts.times++;
                    dragDropCase.attempts.final = sequenceNode.dragDrops[dragDropIndex].split('_')[2] == 'true';
                    if (dragDropCase.attempts.final){
                      dragDropCase.attempts.correctTimes++;
                    } else {
                      dragDropCase.attempts.wrongTimes++;
                    }
                  }
                }
                for (var labelIndex = 0; labelIndex<sequenceNode.labels.length; labelIndex++) {
                  questionNode.workout_label.times++;
                  if (sequenceNode.labels[labelIndex] == 'true') {
                    questionNode.workout_label.correctTimes++;
                  } else {
                    questionNode.workout_label.wrongTimes++;
                  }
                }
                for (var eqIndex = 0; eqIndex<sequenceNode.equationElements.length; eqIndex++) {
                  var eqName = sequenceNode.equationElements[eqIndex].split('_')[0];
                  var eqObject = questionNode.workout_equation[eqName];
                  if (!eqObject) {
                    eqObject = {};
                    eqObject.times = 0;
                    eqObject.correctTimes = 0;
                    eqObject.wrongTimes = 0;
                    questionNode.workout_equation[eqName] = eqObject;
                  }
                  eqObject.times++;
                  if (sequenceNode.equationElements[eqIndex].split('_')[1]) {
                    eqObject.correctTimes++;
                  } else {
                    eqObject.wrongTimes++;
                  }
                }
                break;
              case 'A':
                for (var answerIndex = 0; answerIndex<sequenceNode.answers.length; answerIndex++) {
                  questionNode.answer.times++;
                  questionNode.answer.final = sequenceNode.answers[answerIndex];
                  if (sequenceNode.answers[answerIndex]) {
                    questionNode.answer.correctTimes++;
                  } else {
                    questionNode.answer.wrongTimes++;
                  }
                }
                break;
              case 'CA':
                currentActivityNode.completed = true;
                break;
              case 'CM':
                currentActivityNode.reinforcementTimes++;
                currentActivityNode.completed = true;
                break;
              case 'WR':
                questionNode.wrong_answer_reaction.review++;
                break;
              case 'WI':
                questionNode.wrong_answer_reaction.ignore++;
                break;
              case 'WH':
                questionNode.wrong_answer_reaction.hint++;
                break;
            }
          }

          // update questionSummary
          currentActivityNode.questionSummary.questionNumber++;
          currentActivityNode.questionSummary.questionNumber += questionNode.duration;
          if (questionNode.highlightedWords) {
            for (var i_highlight = 0; i_highlight<questionNode.highlightedWords.length; i_highlight++) {
              if (questionNode.highlightedWords[i_highlight].highlight) {
                currentActivityNode.questionSummary.highlightedWords ++;    
              }
            }
          }
          
          if (questionNode.workout_planType) {
            currentActivityNode.questionSummary.workout_planType.times += questionNode.workout_planType.times;
            currentActivityNode.questionSummary.workout_planType.correct += questionNode.workout_planType.correctTimes;
            if (questionNode.workout_planType.final) {
              currentActivityNode.questionSummary.workout_planType.submitTimes++;
              //console.log('_' + questionNode.workout_planType.final +' vs '+ questionData.type.substr(6,1).toLowerCase());
              if (questionNode.workout_planType.final == questionData.type.substr(6,1).toLowerCase()) {
                currentActivityNode.questionSummary.workout_planType.correctSubmitTimes ++;
              }
            }
          }
          
          if (questionNode.workout_planModel) {
            currentActivityNode.questionSummary.workout_planModel.times += questionNode.workout_planModel.times;
            currentActivityNode.questionSummary.workout_planModel.correct += questionNode.workout_planModel.correctTimes;
            if (questionNode.workout_planModel.final) {
              currentActivityNode.questionSummary.workout_planModel.submitTimes++;
              //console.log('_' + questionNode.workout_planModel.final.toLowerCase() +' vs '+ questionData.type.substr(6).toLowerCase());
              if (questionNode.workout_planModel.final.toLowerCase() == questionData.type.substr(6).toLowerCase()) {
                currentActivityNode.questionSummary.workout_planModel.correctSubmitTimes ++;
              }
            }
          }

          if (questionNode.workout_dragDrops && questionNode.workout_dragDrops.fields) {
            for (var i_ddf = 0; i_ddf<questionNode.workout_dragDrops.fields.length; i_ddf++) {
              currentActivityNode.questionSummary.workout_dragDrops.incomplete_attempts += questionNode.workout_dragDrops.fields[i_ddf].incomplete_attempts;
              currentActivityNode.questionSummary.workout_dragDrops.complete_attempts += questionNode.workout_dragDrops.fields[i_ddf].attempts.times;
              currentActivityNode.questionSummary.workout_dragDrops.correct_attampts += questionNode.workout_dragDrops.fields[i_ddf].attempts.correctTimes;
            }
          }

          if (questionNode.workout_equation) {
            for (var i_eq = 0; i_eq<questionNode.workout_equation.length; i_eq++) {
              currentActivityNode.questionSummary.workout_equation.times += questionNode.workout_equation[i_eq].times;
              currentActivityNode.questionSummary.workout_equation.correct += questionNode.workout_equation[i_eq].correctTimes;
            }
          }

          if (questionNode.answer) {
            currentActivityNode.questionSummary.answer.times += questionNode.answer.times;
            currentActivityNode.questionSummary.answer.correct += questionNode.answer.correctTimes;
            if (questionNode.answer.final !== null) {
              currentActivityNode.questionSummary.answer.submitTimes++;
              if (questionNode.answer.final) {
                currentActivityNode.questionSummary.answer.correctSubmitTimes ++;
              }
            }
          }

          if (questionNode.wrong_answer_reaction) {
            currentActivityNode.questionSummary.wrong_answer_reaction.ignore += questionNode.wrong_answer_reaction.ignore;
            currentActivityNode.questionSummary.wrong_answer_reaction.review += questionNode.wrong_answer_reaction.review;
            currentActivityNode.questionSummary.wrong_answer_reaction.hint += questionNode.wrong_answer_reaction.hint;
          }
          // end of updating questionSummary

        }

      });
      // end of activities

      //summarize session node
      currentSessionNode.start = currentSessionNode.activities[0].start;
      currentSessionNode.end = currentSessionNode.activities[currentSessionNode.activities.length-1].end;
      currentSessionNode.duration = currentSessionNode.end.getTime() - currentSessionNode.start.getTime();
      currentSessionNode.offTask = {};
      currentSessionNode.offTask.instances = [];
      currentSessionNode.offTask.duration = 0;
      currentSessionNode.videos = {};
      currentSessionNode.reinforcedActivities = 0;
      currentSessionNode.completedActivities = 0;
      currentSessionNode.questionSummary = {};
      currentSessionNode.questionSummary.questionNumber = 0;
      currentSessionNode.questionSummary.duration = 0;
      currentSessionNode.questionSummary.correct = 0;
      currentSessionNode.questionSummary.highlightedWords = 0;
      currentSessionNode.questionSummary.workout_planType = {};
      currentSessionNode.questionSummary.workout_planType.times = 0;
      currentSessionNode.questionSummary.workout_planType.correct = 0;
      currentSessionNode.questionSummary.workout_planType.submitTimes = 0;
      currentSessionNode.questionSummary.workout_planType.correctSubmitTimes = 0;
      currentSessionNode.questionSummary.workout_planModel = {};
      currentSessionNode.questionSummary.workout_planModel.times = 0;
      currentSessionNode.questionSummary.workout_planModel.correct = 0;
      currentSessionNode.questionSummary.workout_planModel.submitTimes = 0;
      currentSessionNode.questionSummary.workout_planModel.correctSubmitTimes = 0;
      currentSessionNode.questionSummary.workout_dragDrops = {};
      currentSessionNode.questionSummary.workout_dragDrops.incomplete_attempts = 0;
      currentSessionNode.questionSummary.workout_dragDrops.complete_attempts = 0;
      currentSessionNode.questionSummary.workout_dragDrops.correct_attampts = 0;
      currentSessionNode.questionSummary.workout_equation = {};
      currentSessionNode.questionSummary.workout_equation.times = 0;
      currentSessionNode.questionSummary.workout_equation.correct = 0;
      currentSessionNode.questionSummary.answer = {};
      currentSessionNode.questionSummary.answer.times = 0;
      currentSessionNode.questionSummary.answer.correct = 0;
      currentSessionNode.questionSummary.answer.submitTimes = 0;
      currentSessionNode.questionSummary.answer.correctSubmitTimes = 0;
      currentSessionNode.questionSummary.wrong_answer_reaction = {};
      currentSessionNode.questionSummary.wrong_answer_reaction.ignore = 0;
      currentSessionNode.questionSummary.wrong_answer_reaction.review = 0;
      currentSessionNode.questionSummary.wrong_answer_reaction.hint = 0;


      for (var i = 0; i<currentSessionNode.activities.length; i++) {
        // offTask
        Array.prototype.push.apply(currentSessionNode.offTask.instances, currentSessionNode.activities[i].offTask.instances);
        currentSessionNode.offTask.duration += currentSessionNode.activities[i].offTask.totalduration;

        var videoID;

        //video
        for (videoID in currentSessionNode.activities[i].videos) {
          if (!currentSessionNode.videos[videoID]) {
            currentSessionNode.videos[videoID] = {};
            currentSessionNode.videos[videoID].activeDuration = 0;
            currentSessionNode.videos[videoID].pauseTimes = 0;
            currentSessionNode.videos[videoID].pauseDuration = 0;
            currentSessionNode.videos[videoID].watchedIntervals = {};
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
        for (videoID in currentSessionNode.videos) {
          if (currentSessionNode.videos[videoID].watchedIntervals.rawIntervals && 
            (currentSessionNode.videos[videoID].watchedPercentage >= 1 ||
             currentSessionNode.videos[videoID].watchedIntervals.rawIntervals.length === 0)) continue;
          currentSessionNode.videos[videoID].watchedIntervals = unionPlayedVideoIntervals(currentSessionNode.videos[videoID].watchedIntervals.rawIntervals);
          currentSessionNode.videos[videoID].watchedPercentage = currentSessionNode.videos[videoID].watchedIntervals.playedLength / videoDuration[videoID];
          if (currentSessionNode.videos[videoID].watchedPercentage > 0.99)
            currentSessionNode.videos[videoID].watchedPercentage = 1;  
        }

        if (currentSessionNode.activities[i].reinforcementTimes>0) {
          currentSessionNode.reinforcedActivities++;
        }
        if (currentSessionNode.activities[i].complete) {
          currentSessionNode.completedActivities++;
        }

        // questionSummary
        currentSessionNode.questionSummary.questionNumber += currentSessionNode.activities[i].questionSummary.questionNumber;
        currentSessionNode.questionSummary.duration += currentSessionNode.activities[i].questionSummary.duration;
        currentSessionNode.questionSummary.correct += currentSessionNode.activities[i].questionSummary.correct;
        currentSessionNode.questionSummary.highlightedWords += currentSessionNode.activities[i].questionSummary.highlightedWords;
        currentSessionNode.questionSummary.workout_planType.times += currentSessionNode.activities[i].questionSummary.workout_planType.times;
        currentSessionNode.questionSummary.workout_planType.correct += currentSessionNode.activities[i].questionSummary.workout_planType.correct;
        currentSessionNode.questionSummary.workout_planType.submitTimes += currentSessionNode.activities[i].questionSummary.workout_planType.submitTimes;
        currentSessionNode.questionSummary.workout_planType.correctSubmitTimes += currentSessionNode.activities[i].questionSummary.workout_planType.correctSubmitTimes;
        currentSessionNode.questionSummary.workout_planModel.times += currentSessionNode.activities[i].questionSummary.workout_planModel.times;
        currentSessionNode.questionSummary.workout_planModel.correct += currentSessionNode.activities[i].questionSummary.workout_planModel.correct;
        currentSessionNode.questionSummary.workout_planModel.submitTimes += currentSessionNode.activities[i].questionSummary.workout_planModel.submitTimes;
        currentSessionNode.questionSummary.workout_planModel.correctSubmitTimes += currentSessionNode.activities[i].questionSummary.workout_planModel.correctSubmitTimes;
        currentSessionNode.questionSummary.workout_dragDrops.incomplete_attempts += currentSessionNode.activities[i].questionSummary.workout_dragDrops.incomplete_attempts;
        currentSessionNode.questionSummary.workout_dragDrops.complete_attempts += currentSessionNode.activities[i].questionSummary.workout_dragDrops.complete_attempts;
        currentSessionNode.questionSummary.workout_dragDrops.correct_attampts += currentSessionNode.activities[i].questionSummary.workout_dragDrops.correct_attampts;
        currentSessionNode.questionSummary.workout_equation.times += currentSessionNode.activities[i].questionSummary.workout_equation.times;
        currentSessionNode.questionSummary.workout_equation.correct += currentSessionNode.activities[i].questionSummary.workout_equation.correct;
        currentSessionNode.questionSummary.answer.times += currentSessionNode.activities[i].questionSummary.answer.times;
        currentSessionNode.questionSummary.answer.correct += currentSessionNode.activities[i].questionSummary.answer.correct;
        currentSessionNode.questionSummary.answer.submitTimes += currentSessionNode.activities[i].questionSummary.answer.submitTimes;
        currentSessionNode.questionSummary.answer.correctSubmitTimes += currentSessionNode.activities[i].questionSummary.answer.correctSubmitTimes;
        currentSessionNode.questionSummary.wrong_answer_reaction.ignore += currentSessionNode.activities[i].questionSummary.wrong_answer_reaction.ignore;
        currentSessionNode.questionSummary.wrong_answer_reaction.review += currentSessionNode.activities[i].questionSummary.wrong_answer_reaction.review;
        currentSessionNode.questionSummary.wrong_answer_reaction.hint += currentSessionNode.activities[i].questionSummary.wrong_answer_reaction.hint;

      }

    });
    // end of sessions

    currentSubjectNode.duration = 0;
    currentSubjectNode.offTask = {};
    currentSubjectNode.offTask.instances = [];
    currentSubjectNode.offTask.duration = 0;
    currentSubjectNode.videos = {};
    currentSubjectNode.reinforcedActivities = 0;
    currentSubjectNode.completedActivities = 0;
    currentSubjectNode.questionSummary = {};
    currentSubjectNode.questionSummary.questionNumber = 0;
    currentSubjectNode.questionSummary.duration = 0;
    currentSubjectNode.questionSummary.correct = 0;
    currentSubjectNode.questionSummary.highlightedWords = 0;
    currentSubjectNode.questionSummary.workout_planType = {};
    currentSubjectNode.questionSummary.workout_planType.times = 0;
    currentSubjectNode.questionSummary.workout_planType.correct = 0;
    currentSubjectNode.questionSummary.workout_planType.submitTimes = 0;
    currentSubjectNode.questionSummary.workout_planType.correctSubmitTimes = 0;
    currentSubjectNode.questionSummary.workout_planModel = {};
    currentSubjectNode.questionSummary.workout_planModel.times = 0;
    currentSubjectNode.questionSummary.workout_planModel.correct = 0;
    currentSubjectNode.questionSummary.workout_planModel.submitTimes = 0;
    currentSubjectNode.questionSummary.workout_planModel.correctSubmitTimes = 0;
    currentSubjectNode.questionSummary.workout_dragDrops = {};
    currentSubjectNode.questionSummary.workout_dragDrops.incomplete_attempts = 0;
    currentSubjectNode.questionSummary.workout_dragDrops.complete_attempts = 0;
    currentSubjectNode.questionSummary.workout_dragDrops.correct_attampts = 0;
    currentSubjectNode.questionSummary.workout_equation = {};
    currentSubjectNode.questionSummary.workout_equation.times = 0;
    currentSubjectNode.questionSummary.workout_equation.correct = 0;
    currentSubjectNode.questionSummary.answer = {};
    currentSubjectNode.questionSummary.answer.times = 0;
    currentSubjectNode.questionSummary.answer.correct = 0;
    currentSubjectNode.questionSummary.answer.submitTimes = 0;
    currentSubjectNode.questionSummary.answer.correctSubmitTimes = 0;
    currentSubjectNode.questionSummary.wrong_answer_reaction = {};
    currentSubjectNode.questionSummary.wrong_answer_reaction.ignore = 0;
    currentSubjectNode.questionSummary.wrong_answer_reaction.review = 0;
    currentSubjectNode.questionSummary.wrong_answer_reaction.hint = 0;

    for (var i_ssn = 0; i_ssn < currentSubjectNode.sessions.length; i_ssn++) {
      currentSubjectNode.duration += currentSubjectNode.sessions[i_ssn].duration;
      Array.prototype.push.apply(currentSubjectNode.offTask.instances, currentSubjectNode.sessions[i_ssn].offTask.instances);
      currentSubjectNode.offTask.duration += currentSubjectNode.sessions[i_ssn].offTask.duration;

      var videoID;

      for (videoID in currentSubjectNode.sessions[i_ssn].videos) {
        if (!currentSubjectNode.videos[videoID]) {
          currentSubjectNode.videos[videoID] = {};
          currentSubjectNode.videos[videoID].activeDuration = 0;
          currentSubjectNode.videos[videoID].pauseTimes = 0;
          currentSubjectNode.videos[videoID].pauseDuration = 0;
          currentSubjectNode.videos[videoID].watchedIntervals = {};
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

      for (videoID in currentSubjectNode.videos) {
        if (currentSubjectNode.videos[videoID].watchedIntervals.rawIntervals &&
          (currentSubjectNode.videos[videoID].watchedPercentage >= 1 ||
           currentSubjectNode.videos[videoID].watchedIntervals.rawIntervals.length < 1))
          continue;
        currentSubjectNode.videos[videoID].watchedIntervals = unionPlayedVideoIntervals(currentSubjectNode.videos[videoID].watchedIntervals.rawIntervals);
        currentSubjectNode.videos[videoID].watchedPercentage = currentSubjectNode.videos[videoID].watchedIntervals.playedLength / videoDuration[videoID];
        if (currentSubjectNode.videos[videoID].watchedPercentage > 0.99)
          currentSubjectNode.videos[videoID].watchedPercentage = 1;
      }

      currentSubjectNode.reinforcedActivities += currentSubjectNode.sessions[i_ssn].reinforcedActivities;
      currentSubjectNode.completedActivities += currentSubjectNode.sessions[i_ssn].completedActivities;
      currentSubjectNode.questionSummary.questionNumber += currentSubjectNode.sessions[i_ssn].questionSummary.questionNumber;
      currentSubjectNode.questionSummary.duration += currentSubjectNode.sessions[i_ssn].questionSummary.duration;
      currentSubjectNode.questionSummary.correct += currentSubjectNode.sessions[i_ssn].questionSummary.correct;
      currentSubjectNode.questionSummary.highlightedWords += currentSubjectNode.sessions[i_ssn].questionSummary.highlightedWords;
      currentSubjectNode.questionSummary.workout_planType.times += currentSubjectNode.sessions[i_ssn].questionSummary.workout_planType.times;
      currentSubjectNode.questionSummary.workout_planType.correct += currentSubjectNode.sessions[i_ssn].questionSummary.workout_planType.correct;
      currentSubjectNode.questionSummary.workout_planType.submitTimes += currentSubjectNode.sessions[i_ssn].questionSummary.workout_planType.submitTimes;
      currentSubjectNode.questionSummary.workout_planType.correctSubmitTimes += currentSubjectNode.sessions[i_ssn].questionSummary.workout_planType.correctSubmitTimes;
      currentSubjectNode.questionSummary.workout_planModel.times += currentSubjectNode.sessions[i_ssn].questionSummary.workout_planModel.times;
      currentSubjectNode.questionSummary.workout_planModel.correct += currentSubjectNode.sessions[i_ssn].questionSummary.workout_planModel.correct;
      currentSubjectNode.questionSummary.workout_planModel.submitTimes += currentSubjectNode.sessions[i_ssn].questionSummary.workout_planModel.submitTimes;
      currentSubjectNode.questionSummary.workout_planModel.correctSubmitTimes += currentSubjectNode.sessions[i_ssn].questionSummary.workout_planModel.correctSubmitTimes;
      currentSubjectNode.questionSummary.workout_dragDrops.incomplete_attempts += currentSubjectNode.sessions[i_ssn].questionSummary.workout_dragDrops.incomplete_attempts;
      currentSubjectNode.questionSummary.workout_dragDrops.complete_attempts += currentSubjectNode.sessions[i_ssn].questionSummary.workout_dragDrops.complete_attempts;
      currentSubjectNode.questionSummary.workout_dragDrops.correct_attampts += currentSubjectNode.sessions[i_ssn].questionSummary.workout_dragDrops.correct_attampts;
      currentSubjectNode.questionSummary.workout_equation.times += currentSubjectNode.sessions[i_ssn].questionSummary.workout_equation.times;
      currentSubjectNode.questionSummary.workout_equation.correct += currentSubjectNode.sessions[i_ssn].questionSummary.workout_equation.correct;
      currentSubjectNode.questionSummary.answer.times += currentSubjectNode.sessions[i_ssn].questionSummary.answer.times;
      currentSubjectNode.questionSummary.answer.correct += currentSubjectNode.sessions[i_ssn].questionSummary.answer.correct;
      currentSubjectNode.questionSummary.answer.submitTimes += currentSubjectNode.sessions[i_ssn].questionSummary.answer.submitTimes;
      currentSubjectNode.questionSummary.answer.correctSubmitTimes += currentSubjectNode.sessions[i_ssn].questionSummary.answer.correctSubmitTimes;
      currentSubjectNode.questionSummary.wrong_answer_reaction.ignore += currentSubjectNode.sessions[i_ssn].questionSummary.wrong_answer_reaction.ignore;
      currentSubjectNode.questionSummary.wrong_answer_reaction.review += currentSubjectNode.sessions[i_ssn].questionSummary.wrong_answer_reaction.review;
      currentSubjectNode.questionSummary.wrong_answer_reaction.hint += currentSubjectNode.sessions[i_ssn].questionSummary.wrong_answer_reaction.hint;
    }
  });
  // end of subjects
}

function startWith(str, key) {
  if (!str) return false;
  return (str.indexOf(key) === 0);
}

function unionPlayedVideoIntervals(intervals) {
  if (intervals === undefined)
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
  var i;

  for (i = 0; i<=key; i++) {
    mergedIntervals.push(intervals[i]);
  }

  for (i = key+1; i< intervals.length; i++) {
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
  if (_response === null) {
    console.error('response is null');
  }

  _response.writeHead(200, {"Content-Type": "application/json"});
  if ( (typeof res) == 'string')
    _response.end(res);
  else
    _response.end( JSON.stringify(res) );
}

var _response = null;

var server = http.createServer(function(request, response) {
  _response = response;
  _response.setHeader('Access-Control-Allow-Origin', '*');
  var parsedUrl = url.parse(request.url, true);
  var index;
  if (parsedUrl.pathname.indexOf("//") === 0) {
    index = parsedUrl.pathname.substr(1);
  } else {
    index = parsedUrl.pathname;
  }

  var resource = routes[index];
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
//server.listen(1337,'127.0.0.1');
// production
server.listen(8000,'127.0.0.1');
console.log('running');
