import * as mturk_api from "mturk-api";
import JSPath from "jspath";

import { Meteor } from "meteor/meteor";
import { check, Match } from "meteor/check";

import { config } from "./config";
import { Workers, Qualifications } from "../lib/common";

let api = undefined;

if (!config.mturk.accessKeyId || !config.mturk.secretAccessKey) {
  Meteor._debug("Missing Amazon API keys for connecting to MTurk. Please configure.");
} else {
  const mturkConfig = {
    access: config.mturk.accessKeyId,
    secret: config.mturk.secretAccessKey,
    sandbox: config.mturk.sandbox
  };

  const promise = mturk_api
    .connect(mturkConfig)
    .then(api => api)
    .catch(console.error);
  api = Promise.resolve(promise).await();
}

export function mturk(op, params) {
  if (api == null) {
    console.log("Ignoring operation " + op + " because MTurk is not configured.");
    return;
  }

  const promise = api.req(op, params).then(resp => resp);
  const result = Promise.resolve(promise).await();

  return transform(op, result);
}

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
    case "CreateHIT":
      return JSPath.apply("..HITId[0]", result);
    case "GetAccountBalance":
      return JSPath.apply("..GetAccountBalanceResult.AvailableBalance.Amount[0]", result);
    case "GetAssignment":
      return JSPath.apply("..Assignment[0]", result);
    case "GetAssignmentsForHIT":
      return JSPath.apply("..GetAssignmentsForHITResult", result);
    case "GetHIT":
      return JSPath.apply("..HIT[0]", result);
    case "GetReviewableHITs":
      return JSPath.apply("..GetReviewableHITsResult", result);
    case "RegisterHITType":
      return JSPath.apply("..HITTypeId[0]", result);
    case "SearchHITs":
      return JSPath.apply("..SearchHITsResult", result);
  }

  return result;
}

export function assignQualification(workerId, qualId, value, notify = true) {
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
    mturk("UpdateQualificationScore", {
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
    mturk("AssignQualification", {
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
}

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
