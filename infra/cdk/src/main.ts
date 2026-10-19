import * as cdk from "aws-cdk-lib";
import { ArculaStack } from "./arcula-stack";
import { ENVIRONMENTS, parseEnvironment } from "./environments";

const app = new cdk.App();

// Which environment this invocation is. Required CDK context (`-c ENV=prod`
// or `-c ENV=dev`): an absent value throws rather than defaulting, so a
// synthesis can never guess. Exactly one stack is created, so every deploy
// must still name it to be unambiguous.
const environment = parseEnvironment(app.node.tryGetContext("ENV"));

new ArculaStack(app, ENVIRONMENTS[environment].stackName, { environment });
