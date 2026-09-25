import { Effect, Schema, Scope } from "effect";
import * as Machine from "../Machine.js";
import * as Resume from "../Resume.js";
import type * as Component from "../Component.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

class OpenEvent extends Schema.TaggedClass<OpenEvent>()("OpenEvent", {}) {}
class CloseEvent extends Schema.TaggedClass<CloseEvent>()("CloseEvent", {}) {}

class Idle extends Schema.TaggedClass<Idle>()("Idle", {}) {}
class Open extends Schema.TaggedClass<Open>()("Open", {
  highlighted: Schema.NullOr(Schema.Number),
}) {}

const Root = Machine.state({ states: { Idle, Open } });
const targets = Machine.targets(Root);

const Disclosure = Machine.make({
  id: "disclosure",
  root: Root,
  events: Machine.eventsFromSchemas(OpenEvent, CloseEvent),
}).handle({
  initial: { target: targets.root.Idle },
  states: {
    Idle: { on: { OpenEvent: { target: targets.root.Open, data: { highlighted: null } } } },
    Open: { on: { CloseEvent: { target: targets.root.Idle } } },
  },
});

const spawnEffect: Effect.Effect<
  Machine.SpawnedMachine<OpenEvent | CloseEvent>,
  unknown,
  Scope.Scope
> = Machine.spawn(Disclosure);

void spawnEffect;

type Handle = Machine.SpawnedMachine<OpenEvent | CloseEvent>;

type _StateIsStateAtom = Expect<
  Equal<Handle["state"], Component.StateAtom<Machine.EncodedSnapshotValue>>
>;

type _SendAcceptsEvents = Expect<
  Equal<Parameters<Handle["send"]>[0], OpenEvent | CloseEvent>
>;

const policy: Resume.StateSnapshotPolicy<
  Machine.EncodedSnapshotValue,
  Machine.EncodedSnapshotValue
> = Machine.snapshotPolicy();

void policy;

const decoded: Machine.EncodedSnapshotValue =
  Schema.decodeUnknownSync(Machine.EncodedSnapshotSchema)({
    _tag: "MachineSnapshot",
    version: 2,
    active: [{ path: "" }, { path: "Idle", value: { _tag: "Idle" } }],
  });

void decoded;

const machineCheck: boolean = Machine.isMachine(Disclosure);
void machineCheck;
