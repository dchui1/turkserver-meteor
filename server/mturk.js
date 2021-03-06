// const mturk = Npm.require("api-mturk");
var AWS = require('aws-sdk');
const JSPath = Npm.require("jspath");

let api = undefined;

if (!TurkServer.config.mturk.accessKeyId || !TurkServer.config.mturk.secretAccessKey) {
  Meteor._debug("Missing Amazon API keys for connecting to MTurk. Please configure.");
} else {

  endpoint = "mturk-requester" + (TurkServer.config.mturk.sandbox ? "-sandbox": "")+
    "." + TurkServer.config.mturk.region + ".amazonaws.com"

  console.log("Endpoint", endpoint)
  const config = {
    access: TurkServer.config.mturk.accessKeyId,
    secret: TurkServer.config.mturk.secretAccessKey,
    region: TurkServer.config.mturk.region,
    sandbox: TurkServer.config.mturk.sandbox,
    endpoint: endpoint
  };

  api = new AWS.MTurk(config);

}


TurkServer.mturk = function(op, params) {
  // console.log("The op", op);


  if (!api) {
    console.log("Ignoring operation " + op + " because MTurk is not configured.");
    return;
  }

  callback = function(err, data) {
    if (err) console.log(err, err.stack);
    else {
      console.log("Returned data", data);
    }
  }
  promise = api[op](params).promise();
  // console.log("Result", result)
  const result = Promise.resolve(promise).await();
  // const result =
  // console.log("MTurk result", result)

  return transform(op, result);

};

/*
  Translate results to be a little more similar to the original code:
  https://github.com/jefftimesten/mturk/blob/master/index.js

  Docs at https://github.com/dfilatov/jspath:
  expressions always return an array;
  with [0] at the end return the first match.

  XXX we may not necessarily want to continue using these in the future.
   This is just for compatibility with what the previous API returned.
 */
function transform(op, result) {
  switch (op) {
    case "createHITWithHITType":
      return JSPath.apply("..HITId[0]", result);
    case "getAccountBalance":
      return JSPath.apply("..AvailableBalance", result);
    case "getAssignment":
      return JSPath.apply("..Assignment[0]", result);
    case "GetAssignmentsForHIT":
      return JSPath.apply("..GetAssignmentsForHITResult", result);
    case "getHIT":
      return JSPath.apply("..HIT[0]", result);
    case "GetReviewableHITs":
      return JSPath.apply("..GetReviewableHITsResult", result);
    case "createHITType":
      return JSPath.apply("..HITTypeId[0]", result);
    case "SearchHITs":
      return JSPath.apply("..SearchHITsResult", result);

  }

  return result;
}

TurkServer.Util = TurkServer.Util || {};

TurkServer.Util.assignQualification = function(workerId, qualId, value, notify = true) {
  check(workerId, String);
  check(qualId, String);
  check(value, Match.Integer);

  if (Workers.findOne(workerId) == null) {
    throw new Error("Unknown worker");
  }

  if (
    Workers.findOne({
      _id: workerId,
      "quals.id": qualId
    }) != null
  ) {
    TurkServer.mturk("UpdateQualificationScore", {
      SubjectId: workerId,
      QualificationTypeId: qualId,
      IntegerValue: value
    });
    Workers.update(
      {
        _id: workerId,
        "quals.id": qualId
      },
      {
        $set: {
          "quals.$.value": value
        }
      }
    );
  } else {
    TurkServer.mturk("AssignQualification", {
      WorkerId: workerId,
      QualificationTypeId: qualId,
      IntegerValue: value,
      SendNotification: notify
    });
    Workers.update(workerId, {
      $push: {
        quals: {
          id: qualId,
          value: value
        }
      }
    });
  }
};

Meteor.startup(function() {
  Qualifications.upsert(
    {
      name: "US Worker"
    },
    {
      $set: {
        QualificationTypeId: "00000000000000000071",
        Comparator: "EqualTo",
        LocaleValue: "US"
      }
    }
  );
  Qualifications.upsert(
    {
      name: "US or CA Worker"
    },
    {
      $set: {
        QualificationTypeId: "00000000000000000071",
        Comparator: "In",
        LocaleValue: ["US", "CA"]
      }
    }
  );
  Qualifications.upsert(
    {
      name: "> 100 HITs"
    },
    {
      $set: {
        QualificationTypeId: "00000000000000000040",
        Comparator: "GreaterThan",
        IntegerValue: "100"
      }
    }
  );
  Qualifications.upsert(
    {
      name: "95% Approval"
    },
    {
      $set: {
        QualificationTypeId: "000000000000000000L0",
        Comparator: "GreaterThanOrEqualTo",
        IntegerValue: "95"
      }
    }
  );
  Qualifications.upsert(
    {
      name: "Master Workers"
    },
    {
      $set: {
        QualificationTypeId: "2F1QJWKUDD8XADTFD2Q0G6UTO95ALH",
        Comparator: "Exists"

      }
    }
  );
  Qualifications.upsert(
    {
      name: "Adult Worker"
    },
    {
      $set: {
        QualificationTypeId: "00000000000000000060",
        Comparator: "EqualTo",
        IntegerValue: "1"
      }
    }
  );
});
