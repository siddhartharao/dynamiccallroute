//  “Copyright Amazon.com Inc. or its affiliates.”
const AWS = require("aws-sdk");
const wavFileBucket = process.env["WAVFILE_BUCKET"];
const callInfoTable = process.env["CALLINFO_TABLE_NAME"];
const salesNumber = process.env["SALES_PHONE_NUMBER"];
const supportNumber = process.env["SUPPORT_PHONE_NUMBER"];
var documentClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event, context, callback) => {
  console.log("Lambda is invoked with calldetails:" + JSON.stringify(event));
  let actions;

  switch (event.InvocationEventType) {
    case "NEW_INBOUND_CALL":
      console.log("INBOUND CALL - TRANSFERRING TO CONNECT");
      const callInfo = {
        transactionId: event.CallDetails.TransactionId,
        callIdentifier: Math.floor(Math.random() * 1000000000).toString(),
        callStatus: "TransferToConnect",
      };

      console.log("putting in Dynamo: " + JSON.stringify(callInfo));
      putCaller(callInfo);
      callAndBridgeAction.Parameters.CallerIdNumber =
        event.CallDetails.Participants[0].From;
      callAndBridgeAction.Parameters.Endpoints[0].Uri = supportNumber;
      callAndBridgeAction.Parameters.SipHeaders["User-to-User"] = "None";
      callAndBridgeAction.Parameters.SipHeaders.Diversion =
        "sip:+1" +
        callInfo.callIdentifier +
        "@public.test.com;reason=unconditional";
      actions = [callAndBridgeAction];
      break;

    case "ACTION_SUCCESSFUL":
      console.log("SUCCESS ACTION");
      actions = [];
      break;

    case "RINGING":
      console.log("RINGING");
      actions = [];
      break;

    case "HANGUP":
      console.log("HANGUP ACTION");
      var currentCall = await getCaller(event.CallDetails.TransactionId);
      if (
        event.CallDetails.Participants[0].ParticipantTag === "LEG-B" &&
        currentCall.callStatus === "TransferToPBX"
      ) {
        console.log("HANGUP FROM Connect");
        updateCaller(currentCall);
        callAndBridgeAction.Parameters.CallerIdNumber =
          event.CallDetails.Participants[0].From;
        callAndBridgeAction.Parameters.Endpoints[0].Uri = salesNumber;
        callAndBridgeAction.Parameters.SipHeaders["User-to-User"] =
          currentCall.contactId;
        callAndBridgeAction.Parameters.SipHeaders.Diversion =
          "sip:" +
          currentCall.callIdentifier +
          "@public.test.com;reason=unconditional";
        actions = [callAndBridgeAction];
        break;
      } else if (
        event.CallDetails.Participants[0].ParticipantTag === "LEG-B" &&
        currentCall.callStatus === "CallTransfered"
      ) {
        console.log("HANGUP from PBX");
        hangupAction.Parameters.ParticipantTag = "LEG-A";
        actions = [hangupAction];
        break;
      } else if (event.CallDetails.Participants[0].ParticipantTag === "LEG-A") {
        console.log("HANGUP FROM LEG-A");
        hangupAction.Parameters.ParticipantTag = "LEG-B";
        actions = [hangupAction];
        break;
      } else {
        actions = [];
        break;
      }

    case "CALL_ANSWERED":
      console.log("CALL ANSWERED");
      actions = [];
      break;

    default:
      console.log("FAILED ACTION");
      actions = [];
  }

  const response = {
    SchemaVersion: "1.0",
    Actions: actions,
  };

  console.log("Sending response:" + JSON.stringify(response));

  callback(null, response);
};

const hangupAction = {
  Type: "Hangup",
  Parameters: {
    SipResponseCode: "0",
    ParticipantTag: "",
  },
};

const callAndBridgeAction = {
  Type: "CallAndBridge",
  Parameters: {
    CallTimeoutSeconds: "20", // integer, optional
    CallerIdNumber: "", // required - this phone number must belong to the customer or be the From number of the A Leg
    Endpoints: [
      {
        Uri: "", // required
        BridgeEndpointType: "PSTN", // required
      },
    ],
    SipHeaders: {
      Diversion: "",
      "User-to-User": "",
    },
  },
};

const pauseAction = {
  Type: "Pause",
  Parameters: {
    DurationInMilliseconds: "1000",
  },
};

async function putCaller(callInfo) {
  var params = {
    TableName: callInfoTable,
    Item: {
      transactionId: callInfo.transactionId,
      callIdentifier: callInfo.callIdentifier,
      callStatus: callInfo.callStatus,
    },
  };

  try {
    const results = await documentClient.put(params).promise();
    console.log(results);
    return results;
  } catch (err) {
    console.log(err);
    return err;
  }
}

async function updateCaller(callInfo) {
  var params = {
    TableName: callInfoTable,
    Key: {
      callIdentifier: callInfo.callIdentifier,
    },
    UpdateExpression: "set callStatus = :s",
    ExpressionAttributeValues: {
      ":s": "CallTransfered",
    },
  };
  console.log(params);
  try {
    const results = await documentClient.update(params).promise();
    console.log(results);
    return results;
  } catch (err) {
    console.log(err);
    return err;
  }
}

async function getCaller(transactionId) {
  var params = {
    TableName: callInfoTable,
    IndexName: "transactionId-index",
    KeyConditionExpression: "transactionId = :t",
    ExpressionAttributeValues: {
      ":t": transactionId,
    },
  };

  console.log(params);
  try {
    const results = await documentClient.query(params).promise();
    console.log(results);
    if (results) {
      const dbResponse = {
        callIdentifier: results.Items[0].callIdentifier,
        callStatus: results.Items[0].callStatus,
        contactId: results.Items[0].contactId,
      };
      console.log({ dbResponse });
      return dbResponse;
    } else {
      console.log("Account ID not found");
      return false;
    }
  } catch (err) {
    console.log(err);
    console.log("No phone found");
    return false;
  }
}
