// TODO: This file was created by bulk-decaffeinate.
// Sanity-check the conversion and remove this comment.
/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// Server admin code
const isAdmin = userId => userId != null && __guard__(Meteor.users.findOne(userId), x => x.admin);

// Only admin gets server facts
Facts.setUserIdFilter(isAdmin);

/*
  TODO eliminate unnecessary fields sent over below
*/

// Publish all admin data for /turkserver
Meteor.publish("tsAdmin", function() {
  if (!isAdmin(this.userId)) {
    return [];
  }

  return [Batches.find(), Treatments.find(), Qualifications.find(), HITTypes.find(), HITs.find()];
});

const userFindOptions = {
  fields: {
    status: 1,
    turkserver: 1,
    username: 1,
    workerId: 1
  }
};

Meteor.publish("tsAdminUsers", function(groupId) {
  if (!isAdmin(this.userId)) {
    return [];
  }

  // When in a group, override whatever user publication the group sends with our fields
  // TODO Don't publish all users for /turkserver
  return Meteor.users.find({}, userFindOptions);
});

// Don't return status here as the user is not connected to this experiment
const offlineFindOptions = {
  fields: {
    turkserver: 1,
    username: 1,
    workerId: 1
  }
};

// Helper publish function to get users for experiments that have ended.
// Necessary to watch completed experiments.
Meteor.publish("tsGroupUsers", function(groupId) {
  if (!isAdmin(this.userId)) {
    return [];
  }

  const exp = Experiments.findOne(groupId);
  if (!exp) {
    return [];
  }
  const expUsers = exp.users || [];

  // This won't update if users changes, but it shouldn't after an experiment is completed
  // TODO Just return everything here; we don't know what the app subscription was using
  return Meteor.users.find({ _id: { $in: expUsers } }, offlineFindOptions);
});

// Get a date that is `days` away from `date`, locked to day boundaries
// See https://kadira.io/academy/improve-cpu-and-network-usage/
const getDateFloor = function(date, days) {
  const timestamp = date.valueOf();
  const closestDay = timestamp - (timestamp % (24 * 3600 * 1000));
  return new Date(closestDay + days * 24 * 3600 * 1000);
};

// Data for a single worker
Meteor.publish("tsAdminWorkerData", function(workerId) {
  if (!isAdmin(this.userId)) {
    return [];
  }
  check(workerId, String);

  // TODO also return users here if they are not all published
  return [Workers.find(workerId), Assignments.find({ workerId })];
});

Meteor.publish("tsAdminWorkers", function() {
  if (!isAdmin(this.userId)) {
    return [];
  }
  return [Workers.find(), WorkerEmails.find()];
});

Meteor.publish("tsAdminActiveAssignments", function(batchId) {
  if (!isAdmin(this.userId)) {
    return [];
  }
  check(batchId, String);

  // TODO this isn't fully indexed
  return Assignments.find({
    batchId,
    submitTime: null,
    status: "assigned"
  });
});

Meteor.publish("tsAdminCompletedAssignments", function(batchId, days, limit) {
  if (!isAdmin(this.userId)) {
    return [];
  }
  check(batchId, String);
  check(days, Number);
  check(limit, Number);

  const threshold = getDateFloor(new Date(), -days);

  // effectively { status: "completed" } but there is an index on submitTime
  return Assignments.find(
    {
      batchId,
      submitTime: { $gte: threshold }
    },
    {
      sort: { submitTime: -1 },
      limit
    }
  );
});

// Publish a single instance to the admin.
Meteor.publish("tsAdminInstance", function(instance) {
  if (!isAdmin(this.userId)) {
    return [];
  }
  check(instance, String);
  return Experiments.find(instance);
});

// Two separate publications for running and completed experiments, because
// it's hard to do both endTime: null and endTime > some date while sorting by
// endTime desc, because null sorts below any value.
Meteor.publish("tsAdminBatchRunningExperiments", function(batchId) {
  if (!isAdmin(this.userId)) {
    return [];
  }
  check(batchId, String);

  return Experiments.find({ batchId, endTime: null });
});

Meteor.publish("tsAdminBatchCompletedExperiments", function(batchId, days, limit) {
  if (!isAdmin(this.userId)) {
    return [];
  }
  check(batchId, String);
  check(days, Number);
  check(limit, Number);

  const threshold = getDateFloor(new Date(), -days);

  return Experiments.find(
    {
      batchId,
      endTime: { $gte: threshold }
    },
    {
      sort: { endTime: -1 },
      limit
    }
  );
});

Meteor.publish("tsGroupLogs", function(groupId, limit) {
  if (!isAdmin(this.userId)) {
    return [];
  }

  return [
    Experiments.find(groupId),
    Logs.find(
      { _groupId: groupId },
      {
        sort: { _timestamp: -1 },
        limit
      }
    )
  ];
});

// Get a HIT Type and make sure it is ready for use
const getAndCheckHitType = function(hitTypeId) {
  const hitType = HITTypes.findOne({ HITTypeId: hitTypeId });
  if (!hitType.HITTypeId) {
    throw new Meteor.Error(403, "HITType not registered");
  }
  const batch = Batches.findOne(hitType.batchId);
  if (!batch.active) {
    throw new Meteor.Error(403, "Batch not active; activate it first");
  }
  return hitType;
};

Meteor.methods({
  "ts-admin-account-balance"() {
    TurkServer.checkAdmin();
    try {
      return TurkServer.mturk("getAccountBalance", {});
    } catch (e) {
      throw new Meteor.Error(403, e.toString());
    }
  },

  // This is the only method that uses the _id field of HITType instead of HITTypeId.
  "ts-admin-register-hittype"(hitType_id) {
    TurkServer.checkAdmin();
    // Build up the params to register the HIT Type
    const params = HITTypes.findOne(hitType_id);
    delete params._id;
    delete params.batchId;
    //
    // params.Reward = {
    //   Amount: params.Reward,
    //   CurrencyCode: "USD"
    // };
    // params.Reward = params.

    const quals = [];
    for (let i in params.QualificationRequirements) {
      const qualId = params.QualificationRequirements[i];
      const qual = Qualifications.findOne(qualId);
      delete qual._id;
      delete qual.name;

      // Integer value is fine as array or not, but
      // Get the locale into its weird structure
      if (Array.isArray(qual.LocaleValue)) {
        qual.LocaleValues = Array.from(qual.LocaleValues).map(locale => ({
          Country: locale
        }));
      } else if (qual.LocaleValue) {
        qual.LocaleValues = { Country: qual.LocaleValues };
      }

      quals.push(qual);
    }

    params.QualificationRequirements = quals;

    let hitTypeId = null;
    console.log("HIT params being registered", params)
    try {
      hitTypeId = TurkServer.mturk("createHITType", params);
    } catch (e) {
      throw new Meteor.Error(500, e.toString());
    }

    console.log("Returned hit type id", hitTypeId)

    HITTypes.update(hitType_id, { $set: { HITTypeId: hitTypeId } });
  },

  "ts-admin-create-hit"(hitTypeId, params) {
    TurkServer.checkAdmin();

    const hitType = getAndCheckHitType(hitTypeId);
    console.log("THe hit type", hitType);
    console.log("The hit type ID", hitType.HITTypeId);
    params.HITTypeId = hitType.HITTypeId;

    params.Question = `<ExternalQuestion xmlns="http://mechanicalturk.amazonaws.com/AWSMechanicalTurkDataSchemas/2006-07-14/ExternalQuestion.xsd">
  <ExternalURL>${TurkServer.config.mturk.externalUrl}?batchId=${hitType.batchId}</ExternalURL>
  <FrameHeight>${TurkServer.config.mturk.frameHeight}</FrameHeight>
</ExternalQuestion>\
`;

    let hitId = null;
    try {
      hitId = TurkServer.mturk("createHITWithHITType", params);
      // hitId = TurkServer.mturk("createHIT", params);
    } catch (e) {
      throw new Meteor.Error(500, e.toString());
    }

    HITs.insert({
      HITId: hitId,
      HITTypeId: hitType.HITTypeId
    });

    this.unblock();
    // Immediately refresh HIT data after creation
    Meteor.call("ts-admin-refresh-hit", hitId);
  },

  "ts-admin-refresh-hit"(HITId) {
    console.log("HITId called in refresh hit", HITId)
    TurkServer.checkAdmin();
    if (!HITId) {
      throw new Meteor.Error(400, "HIT ID not specified");
    }
    try {
      const hitData = TurkServer.mturk("getHIT", { HITId });
      HITs.update({ HITId }, { $set: hitData });
    } catch (e) {
      throw new Meteor.Error(500, e.toString());
    }
  },

  "ts-admin-expire-hit"(HITId) {
    throw new Meteor.Error(500, "Not implemented, deprecated");
    TurkServer.checkAdmin();
    if (!HITId) {
      throw new Meteor.Error(400, "HIT ID not specified");
    }
    try {
      const hitData = TurkServer.mturk("updateExpirationForHIT", { HITId });

      this.unblock(); // If successful, refresh the HIT
      Meteor.call("ts-admin-refresh-hit", HITId);
    } catch (e) {
      throw new Meteor.Error(500, e.toString());
    }
  },

  "ts-admin-change-hittype"(params) {

    throw new Meteor.Error(500, "Not implemented, deprecated");
    TurkServer.checkAdmin();
    check(params.HITId, String);
    check(params.HITTypeId, String);

    // TODO: don't allow change if the old HIT Type has a different batchId from the new one
    try {
      TurkServer.mturk("updateHITTypeOfHIT", params);
      this.unblock(); // If successful, refresh the HIT
      Meteor.call("ts-admin-refresh-hit", params.HITId);
    } catch (e) {
      throw new Meteor.Error(500, e.toString());
    }
  },


  //either is CreateAdditionalAssignmentsForHit
  "ts-admin-extend-hit"(params) {
    TurkServer.checkAdmin();
    check(params.HITId, String);

    const hit = HITs.findOne({ HITId: params.HITId });

    getAndCheckHitType(hit.HITTypeId);

    try {
      TurkServer.mturk("createAdditionalAssignmentsForHIT", params);

      this.unblock(); // If successful, refresh the HIT
      Meteor.call("ts-admin-refresh-hit", params.HITId);
    } catch (e) {
      throw new Meteor.Error(500, e.toString());
    }
  },

  "ts-admin-lobby-event"(batchId, event) {
    TurkServer.checkAdmin();
    check(batchId, String);

    const batch = TurkServer.Batch.getBatch(batchId);
    if (batch == null) {
      throw new Meteor.Error(500, `Batch ${batchId} does not exist`);
    }
    const emitter = batch.lobby.events;
    emitter.emit.apply(emitter, Array.prototype.slice.call(arguments, 1)); // Event and any other arguments
  },

  "ts-admin-create-message"(subject, message, copyFromId) {
    let recipients;
    TurkServer.checkAdmin();
    check(subject, String);
    check(message, String);

    if (copyFromId != null) {
      recipients = __guard__(WorkerEmails.findOne(copyFromId), x => x.recipients);
    }

    if (recipients == null) {
      recipients = [];
    }

    return WorkerEmails.insert({ subject, message, recipients });
  },

  "ts-admin-send-message"(emailId) {
    TurkServer.checkAdmin();
    check(emailId, String);

    const email = WorkerEmails.findOne(emailId);
    if (email.sentTime != null) {
      throw new Error(403, "Message already sent");
    }

    const { recipients } = email;

    check(email.subject, String);
    check(email.message, String);
    check(recipients, Array);

    if (recipients.length === 0) {
      throw new Error(403, "No recipients on e-mail");
    }

    let count = 0;

    while (recipients.length > 0) {
      // Notify workers 50 at a time
      const chunk = recipients.splice(0, 50);

      const params = {
        Subject: email.subject,
        MessageText: email.message,
        WorkerId: chunk
      };

      try {
        TurkServer.mturk("notifyWorkers", params);
      } catch (e) {
        throw new Meteor.Error(500, e.toString());
      }

      count += chunk.length;
      Meteor._debug(count + " workers notified");

      // Record which workers got the e-mail in case something breaks
      Workers.update(
        { _id: { $in: chunk } },
        {
          $push: { emailsReceived: emailId }
        },
        { multi: true }
      );
    }

    // Record date that this was sent
    WorkerEmails.update(emailId, { $set: { sentTime: new Date() } });

    return `${count} workers notified.`;
  },

  // TODO implement this
  "ts-admin-resend-message"(emailId) {
    TurkServer.checkAdmin();
    check(emailId, String);

    throw new Meteor.Error(500, "Not implemented");
  },

  "ts-admin-copy-message"(emailId) {
    TurkServer.checkAdmin();
    check(emailId, String);

    const email = WorkerEmails.findOne(emailId);
    return WorkerEmails.insert({
      subject: email.subject,
      message: email.message,
      recipients: []
    });
  },

  "ts-admin-delete-message"(emailId) {
    TurkServer.checkAdmin();
    check(emailId, String);

    const email = WorkerEmails.findOne(emailId);
    if (email.sentTime) {
      throw new Meteor.Error(403, "Email has already been sent");
    }

    WorkerEmails.remove(emailId);
  },

  "ts-admin-cleanup-user-state"() {
    TurkServer.checkAdmin();
    // Find all users that are state: experiment but don't have an active assignment
    // This shouldn't have to be used in most cases
    Meteor.users.find({ "turkserver.state": "experiment" }).map(function(user) {
      if (TurkServer.Assignment.getCurrentUserAssignment(user._id) != null) {
        return;
      }
      return Meteor.users.update(user._id, {
        $unset: { "turkserver.state": null }
      });
    });
  },

  "ts-admin-cancel-assignments"(batchId) {
    TurkServer.checkAdmin();
    check(batchId, String);

    let count = 0;
    Assignments.find({ batchId, status: "assigned" }).map(function(asst) {
      let userGroup;
      const user = Meteor.users.findOne({ workerId: asst.workerId });
      if (user.status != null ? user.status.online : undefined) {
        return;
      }
      const tsAsst = TurkServer.Assignment.getAssignment(asst._id);
      tsAsst.setReturned();

      // if they were disconnected in the middle of an experiment,
      // and the experiment was either never torndown,
      // or torndown with returnToLobby = false
      if ((userGroup = Partitioner.getUserGroup(user._id)) != null) {
        tsAsst._leaveInstance(userGroup);
        Partitioner.clearUserGroup(user._id);
      }

      return count++;
    });

    return `${count} assignments canceled.`;
  },

  // Refresh all assignments in a batch that are either unknown or submitted
  "ts-admin-refresh-assignments"(batchId) {
    console.log("Ts refresh assignments called")
    TurkServer.checkAdmin();
    check(batchId, String);

    // We may encounter more than one error when refreshing a bunch of
    // assignments. This allows things to continue as much as possible, but
    // will throw the first error encountered.
    let err = null;

    Assignments.find({
      batchId,
      status: "completed",
      mturkStatus: { $in: [null, "Submitted"] }
    }).forEach(function(a) {
      const asst = TurkServer.Assignment.getAssignment(a._id);
      // Refresh submitted assignments as they may have been auto-approved

      try {
        return asst.refreshStatus();
      } catch (e) {
        return err != null ? err : (err = e);
      }
    });

    if (err != null) {
      console.log("In the other error", err)
      throw err;
    }
  },

  "ts-admin-refresh-assignment"(asstId) {
    TurkServer.checkAdmin();
    check(asstId, String);

    TurkServer.Assignment.getAssignment(asstId).refreshStatus();
  },

  "ts-admin-approve-assignment"(asstId, msg) {
    TurkServer.checkAdmin();
    check(asstId, String);

    TurkServer.Assignment.getAssignment(asstId).approve(msg);
  },

  "ts-admin-reject-assignment"(asstId, msg) {
    TurkServer.checkAdmin();
    check(asstId, String);

    TurkServer.Assignment.getAssignment(asstId).reject(msg);
  },

  // Count number of submitted assignments in a batch
  "ts-admin-count-submitted"(batchId) {
    TurkServer.checkAdmin();
    check(batchId, String);

    // First refresh everything
    Meteor.call("ts-admin-refresh-assignments", batchId);

    return Assignments.find({
      batchId,
      mturkStatus: "Submitted"
    }).count();
  },

  // Approve all submitted assignments in a batch
  "ts-admin-approve-all"(batchId, msg) {
    TurkServer.checkAdmin();
    check(batchId, String);
    console.log("Approve all assignments called")

    return Assignments.find({
      batchId,
      mturkStatus: "Submitted"
    }).forEach(asst => TurkServer.Assignment.getAssignment(asst._id).approve(msg));
  },

  // Count number of unpaid bonuses in a batch
  "ts-admin-count-unpaid-bonuses"(batchId) {
    TurkServer.checkAdmin();
    check(batchId, String);

    // First refresh everything
    Meteor.call("ts-admin-refresh-assignments", batchId);

    const result = {
      numPaid: 0,
      amt: 0
    };

    Assignments.find({
      batchId,
      mturkStatus: "Approved",
      bonusPayment: { $gt: 0 },
      bonusPaid: { $exists: false }
    }).forEach(function(asst) {
      result.numPaid += 1;
      return (result.amt += asst.bonusPayment);
    });

    return result;
  },

  // Pay all unpaid bonuses in a batch
  "ts-admin-pay-bonuses"(batchId, msg) {
    TurkServer.checkAdmin();
    check(batchId, String);

    Assignments.find({
      batchId,
      mturkStatus: "Approved",
      bonusPayment: { $gt: 0 },
      bonusPaid: { $exists: false }
    }).forEach(asst => TurkServer.Assignment.getAssignment(asst._id).payBonus(msg));
  },

  "ts-admin-unset-bonus"(asstId) {
    TurkServer.checkAdmin();
    check(asstId, String);

    return TurkServer.Assignment.getAssignment(asstId).setPayment(null);
  },

  "ts-admin-pay-bonus"(asstId, amount, reason) {
    console.log("Pay bonus")
    TurkServer.checkAdmin();
    check(asstId, String);
    check(amount, Number);
    check(reason, String);

    // Protect against possible typos in payment amount.
    if (amount > 10.0) {
      throw new Meteor.Error(403, `You probably didn't mean to pay ${amount}`);
    }

    const asst = TurkServer.Assignment.getAssignment(asstId);
    try {
      asst.setPayment(amount);
      asst.payBonus(reason);
    } catch (e) {
      throw new Meteor.Error(403, e.toString());
    }
  },

  "ts-admin-stop-experiment"(groupId) {
    TurkServer.checkAdmin();
    check(groupId, String);

    TurkServer.Instance.getInstance(groupId).teardown();
  },

  "ts-admin-stop-all-experiments"(batchId) {
    TurkServer.checkAdmin();
    check(batchId, String);

    let count = 0;
    Experiments.find({ batchId, endTime: { $exists: false } }).map(function(instance) {
      TurkServer.Instance.getInstance(instance._id).teardown();
      return count++;
    });

    return `${count} instances stopped.`;
  }
});

// Create and set up admin user (and password) if not existent
Meteor.startup(function() {
  const adminPw = TurkServer.config != null ? TurkServer.config.adminPassword : undefined;
  if (adminPw == null) {
    Meteor._debug("No admin password found for Turkserver. Please configure it in your settings.");
    return;
  }

  const adminUser = Meteor.users.findOne({ username: "admin" });
  if (!adminUser) {
    Accounts.createUser({
      username: "admin",
      password: adminPw
    });
    Meteor._debug("Created Turkserver admin user from Meteor.settings.");

    return Meteor.users.update({ username: "admin" }, { $set: { admin: true } });
  } else {
    // Make sure password matches that of settings file
    // Don't change password unless necessary, which pitches login tokens
    if (Accounts._checkPassword(adminUser, adminPw).error) {
      return Accounts.setPassword(adminUser._id, adminPw);
    }
  }
});

function __guard__(value, transform) {
  return typeof value !== "undefined" && value !== null ? transform(value) : undefined;
}
