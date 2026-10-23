const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const flush = require('node:timers/promises').setImmediate;

function loadTypeScript(filename, dependencies, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, Blob, FormData, TextEncoder, Uint8Array, Error, process,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    ...globals,
  }, { filename });
  return module.exports;
}

const expoSource = path.join(path.dirname(require.resolve('expo/package.json')), 'src');
const { installFormDataPatch } = loadTypeScript(path.join(expoSource, 'winter', 'FormData.ts'), {});
const { convertFormDataAsync } = loadTypeScript(path.join(expoSource, 'winter', 'fetch', 'convertFormData.ts'), {
  '../../utils/blobUtils': { blobToArrayBufferAsync: (blob) => blob.arrayBuffer() },
});
class NativeFormData { constructor() { this._parts = []; } }
installFormDataPatch(NativeFormData);

function createApi(os, fileOptions = {}, fetchImpl = async () => { throw new Error('Unexpected fetch'); }) {
  class NativeFile {
    constructor(uri) {
      this.uri = uri;
      this.name = 'selected.png';
      this.type = 'image/png';
      this.size = 4;
      Object.assign(this, fileOptions);
    }
    async bytes() { return new Uint8Array([1, 2, 3, 4]); }
    async arrayBuffer() { return (await this.bytes()).buffer; }
  }
  return loadTypeScript(path.join(__dirname, '..', 'src', 'api.ts'), {
    'expo-secure-store': {},
    'expo-file-system': { File: NativeFile },
    'react-native': { Platform: { OS: os } },
  }, { fetch: fetchImpl });
}

test('native image parts are accepted by the actual SDK 57 multipart converter', async () => {
  const form = new NativeFormData();
  form.append('name', 'Dynamic student name');
  const { appendUploadFile } = createApi('android');
  for (const field of ['photo', 'identityDocument', 'aadhaar', 'file']) {
    await appendUploadFile(form, field, { uri: 'file:///selected.png', mimeType: 'image/png' });
  }
  const converted = await convertFormDataAsync(form, 'test-boundary');
  const body = Buffer.from(converted.body);
  assert.ok(body.includes(Buffer.from('Dynamic student name')));
  assert.equal((body.toString('latin1').match(/filename="selected.png"/g) || []).length, 4);
  assert.equal((body.toString('latin1').match(/content-type: image\/png/g) || []).length, 4);
  assert.ok(body.includes(Buffer.from([1, 2, 3, 4])));
});

test('the SDK converter reproduces the old URI-descriptor failure', async () => {
  const form = new NativeFormData();
  form.append('photo', { uri: 'file:///photo.png', name: 'photo.png', type: 'image/png' });
  await assert.rejects(convertFormDataAsync(form), /Unsupported FormDataPart/);
});

test('web uploads use browser files and preserve their names', async () => {
  const { appendUploadFile } = createApi('web');
  const form = new FormData();
  await appendUploadFile(form, 'photo', { uri: 'blob:test', file: new Blob(['image'], { type: 'image/png' }), fileName: 'student.png' });
  assert.equal(form.get('photo').name, 'student.png');
  assert.equal(form.get('photo').type, 'image/png');
  assert.equal(await form.get('photo').text(), 'image');
});

test('images enforce the exact 10 MB limit', async () => {
  const exact = createApi('android', { size: 10 * 1024 * 1024 });
  await exact.appendUploadFile(new NativeFormData(), 'photo', { uri: 'file:///photo.png' });
  const oversized = createApi('android', { size: 10 * 1024 * 1024 + 1 });
  await assert.rejects(oversized.appendUploadFile(new NativeFormData(), 'photo', { uri: 'file:///photo.png' }), /10 MB/);
});

test('unsupported and empty private images fail before a request is sent', async () => {
  const invalid = createApi('android', { type: 'application/pdf' });
  await assert.rejects(invalid.appendUploadFile(new NativeFormData(), 'aadhaar', { uri: 'file:///card.pdf' }), /JPEG/);
  const empty = createApi('android', { size: 0 });
  await assert.rejects(empty.appendUploadFile(new NativeFormData(), 'photo', { uri: 'file:///empty.png' }), /empty/);
});

test('teacher videos remain supported by the shared helper', async () => {
  const { appendUploadFile } = createApi('android', { type: 'video/mp4', name: 'clip.mp4' });
  const form = new NativeFormData();
  await appendUploadFile(form, 'file', { uri: 'file:///clip.mp4', mimeType: 'video/mp4' }, false);
  const result = await convertFormDataAsync(form);
  assert.ok(Buffer.from(result.body).includes(Buffer.from('content-type: video/mp4')));
});

test('uploads retain auth headers and leave multipart boundary generation to fetch', async () => {
  let request;
  const api = createApi('android', {}, async (_url, options) => {
    request = options;
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  });
  api.setToken('test-session');
  const form = new NativeFormData();
  await api.appendUploadFile(form, 'photo', { uri: 'file:///photo.png' });
  await api.upload('/principal/students/example', form, 'PATCH');
  assert.equal(request.method, 'PATCH');
  assert.equal(request.headers.Authorization, 'Bearer test-session');
  assert.equal(request.headers['Content-Type'], undefined);
  assert.equal(request.body, form);
});

test('API validation and non-JSON errors are visible instead of success-shaped defaults', async () => {
  const invalid = createApi('web', {}, async () => new Response(JSON.stringify({ error: 'Validation failed', details: { fieldErrors: { name: ['Too short'] } } }), { status: 400, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(invalid.api('POST', '/principal/students', {}), /name: Too short/);
  const unavailable = createApi('web', {}, async () => new Response('<html>Error</html>', { status: 502 }));
  await assert.rejects(unavailable.api('GET', '/principal/students'), /Unexpected server response \(502\)/);
});

test('registration success renders the saved name, details and truthful delivery state for students and teachers', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Container = ({ children }) => React.createElement('div', null, children);
  const { RegistrationSuccess } = loadTypeScript(path.join(__dirname, '..', 'src', 'RegistrationSuccess.tsx'), {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      Animated: { Value: class { interpolate() { return 0; } }, View: Container },
      ScrollView: Container, View: Container, Text: Container, StyleSheet: { create: (styles) => styles },
    },
    './ui': { Button: ({ label }) => React.createElement('button', null, label), Card: Container, Sub: Container, colors: {} },
    './ResultPopup': { popup: {} },
  });

  for (const sample of [
    { kind: 'student', name: 'Riya Desai', emailSent: true, detail: 'Nursery – Morning', status: 'Sent' },
    { kind: 'staff', name: 'Anita Shah', emailSent: false, detail: 'TEACHER', status: 'Not sent', temporaryPassword: 'test-only-password' },
    { kind: 'student', name: 'Kabir Patel', emailSent: false, existingAccount: true, detail: 'Jr KG – Noon', status: 'Linked' },
  ]) {
    const markup = renderToStaticMarkup(React.createElement(RegistrationSuccess, {
      kind: sample.kind, result: { ...sample, login: 'test@example.test' }, onAnother() { }, onDone() { },
    }));
    assert.ok(markup.includes(`${sample.name} is added`));
    assert.ok(markup.includes(sample.detail));
    assert.ok(markup.includes(sample.status));
    assert.ok(markup.includes('test@example.test'));
    assert.ok(markup.includes(sample.kind === 'student' ? 'Add another child' : 'Add another teacher / staff'));
    assert.equal(markup.includes('View temporary login details'), !!sample.temporaryPassword);
    assert.ok(!markup.includes('test-only-password'));
  }
});

test('segmented navigation sizes to its text, preserves visible labels and dispatches the correct tabs', () => {
  const React = require('react');
  const View = () => null;
  const TouchableOpacity = () => null;
  const Text = () => null;
  const { Segmented } = loadTypeScript(path.join(__dirname, '..', 'src', 'ui.tsx'), {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View, TouchableOpacity, Text, StyleSheet: { create: (styles) => styles } },
    '@react-navigation/native': {},
    'react-native-safe-area-context': {},
    './api': {},
    './ResultPopup': {},
  });
  for (const tabs of [
    [{ value: 'Classes', label: 'Class', icon: 'school' }, { value: 'Batches', label: 'Batch', icon: 'books' }, { value: 'Fee plans', label: 'Fee', icon: 'fees' }],
    [{ value: 'Students', label: 'Student', icon: 'student' }, { value: 'Teachers & staff', label: 'Teacher', icon: 'teacher' }],
    ['All', 'Due', 'Paid'],
  ]) {
    const chosen = [];
    const first = typeof tabs[0] === 'string' ? tabs[0] : tabs[0].value;
    const surface = Segmented({ tabs, value: first, onChange: (value) => chosen.push(value) });
    const tree = surface.props.children;
    assert.equal(surface.props.style.flexShrink, 0);
    assert.equal(tree.type, View);
    assert.equal(tree.props.style.height, undefined);
    assert.equal(tree.props.style.flexWrap, 'wrap');
    assert.equal(tree.props.style.flexShrink, 0);
    const buttons = tree.props.children;
    assert.equal(buttons.length, tabs.length);
    buttons.forEach((button, index) => {
      const option = typeof tabs[index] === 'string' ? { value: tabs[index], label: tabs[index] } : tabs[index];
      assert.equal(button.type, TouchableOpacity);
      assert.equal(button.props.accessibilityLabel, option.label);
      assert.equal(button.props.accessibilityState.selected, index === 0);
      assert.equal(button.props.style[0].height, undefined);
      assert.ok(button.props.style[0].minHeight >= 48);
      const text = button.props.children.find((child) => child?.type === Text && child.props.children === option.label);
      assert.ok(text, `${option.label} must be rendered as actual text`);
      button.props.onPress();
      assert.equal(chosen[index], option.value);
    });
  }
});

function loadUi(overrides = {}, globals = {}) {
  return loadTypeScript(path.join(__dirname, '..', 'src', 'ui.tsx'), {
    react: require('react'),
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { StyleSheet: { create: (styles) => styles } },
    '@react-navigation/native': {},
    'react-native-safe-area-context': {},
    './api': {},
    './ResultPopup': {},
    ...overrides,
  }, globals);
}

test('form validation checks exact numeric bounds and permits zero where supported', () => {
  const { fieldError } = loadUi();
  const reminder = { key: 'feeReminderDays', label: 'Reminder days', kind: 'number', min: 0, max: 30, integer: true };
  assert.equal(fieldError(reminder, '0'), '');
  assert.equal(fieldError(reminder, '30'), '');
  for (const invalid of ['-1', '31', '1.5', 'Infinity', 'abc', '']) assert.notEqual(fieldError(reminder, invalid), '');
  const amount = { key: 'amount', label: 'Amount', kind: 'money', min: 0.01, max: 21474836.47 };
  assert.equal(fieldError(amount, '0.01'), '');
  assert.equal(fieldError(amount, '21474836.47'), '');
  for (const invalid of ['0', '-0.01', '21474836.48']) assert.notEqual(fieldError(amount, invalid), '');
});

test('forms validate real dates, times and contact details and skip hidden required fields', () => {
  const { fieldError, visibleFields } = loadUi();
  assert.equal(fieldError({ label: 'Date', kind: 'date' }, '2028-02-29'), '');
  assert.notEqual(fieldError({ label: 'Date', kind: 'date' }, '2027-02-29'), '');
  assert.equal(fieldError({ label: 'Time', kind: 'time' }, '23:59'), '');
  assert.notEqual(fieldError({ label: 'Time', kind: 'time' }, '24:00'), '');
  assert.equal(fieldError({ label: 'Phone', kind: 'phone' }, '+91 98765 43210'), '');
  assert.notEqual(fieldError({ label: 'Phone', kind: 'phone' }, '123'), '');
  assert.notEqual(fieldError({ label: 'Email', kind: 'email' }, 'invalid'), '');
  assert.equal(fieldError({ label: 'Note', required: false }, ''), '');
  const fields = [
    { key: 'audience', label: 'Audience' },
    { key: 'classId', label: 'Class', visibleWhen: { key: 'audience', value: 'CLASS' } },
    { key: 'batchId', label: 'Batch', visibleWhen: { key: 'audience', value: 'BATCH' } },
  ];
  assert.equal(visibleFields(fields, { audience: 'SCHOOL' }).length, 1);
  assert.equal(visibleFields(fields, { audience: 'CLASS' })[1].key, 'classId');
  assert.equal(visibleFields(fields, { audience: 'BATCH' })[1].key, 'batchId');
});

test('shared action rows wrap without fixed heights and buttons keep readable labels while busy', () => {
  const React = require('react');
  const View = () => null;
  const Text = () => null;
  const TouchableOpacity = () => null;
  const { ActionRow, Button, Card } = loadUi({
    'react-native': { View, Text, TouchableOpacity, ActivityIndicator: () => null, StyleSheet: { create: (styles) => styles } },
  });
  const row = ActionRow({ children: [React.createElement(Button, { key: 'view', label: 'View profile' }), null, React.createElement(Button, { key: 'edit', label: 'Edit profile' })] });
  assert.equal(row.props.style.flexWrap, 'wrap');
  assert.ok(row.props.style.gap >= 8);
  assert.equal(row.props.children.length, 2);
  for (const action of row.props.children) {
    assert.equal(action.props.style.height, undefined);
    assert.equal(action.props.style.width, undefined);
    assert.equal(action.props.style.maxWidth, '100%');
  }
  const button = Button({ label: 'Save changes', busy: true, onPress() { } });
  assert.equal(button.props.accessibilityState.disabled, true);
  assert.equal(button.props.accessibilityState.busy, true);
  assert.ok(button.props.children.some((child) => child?.type === Text && child.props.children === 'Saving…'));
  assert.equal(Card({ children: 'Content' }).type, View);
  assert.equal(Card({ children: 'Content', onPress() { } }).type, TouchableOpacity);
});

function createFetchHarness() {
  const hooks = [];
  let cursor = 0;
  let pendingFocus;
  let focusCallback;
  let cleanup;
  const requests = [];
  const listeners = new Set();
  const timers = new Map();
  const React = {
    ...require('react'),
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!hooks[index] || deps.some((value, offset) => value !== hooks[index].deps[offset])) hooks[index] = { callback, deps };
      return hooks[index].callback;
    },
  };
  const appState = { currentState: 'active', addEventListener(_event, listener) { listeners.add(listener); return { remove() { listeners.delete(listener); } }; } };
  const { useFetch: fetchHook } = loadUi({
    react: React,
    'react-native': { AppState: appState, StyleSheet: { create: (styles) => styles } },
    '@react-navigation/native': { useFocusEffect(callback) { if (callback !== focusCallback) pendingFocus = callback; } },
    './api': { api(_method, path, _body, options) { return new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })); } },
  }, {
    AbortController,
    setInterval(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  return {
    requests, timers,
    render(path, interval = 0) {
      cursor = 0;
      const result = fetchHook(path, interval);
      if (pendingFocus) { cleanup?.(); focusCallback = pendingFocus; pendingFocus = undefined; cleanup = focusCallback(); }
      return result;
    },
    background() { appState.currentState = 'background'; },
    resume() { appState.currentState = 'active'; for (const listener of listeners) listener('active'); },
    unmount() { cleanup?.(); },
  };
}

test('fetch ignores stale paths and out-of-order requests, and preserves cached data on refresh failure', async () => {
  const harness = createFetchHarness();
  harness.render('/students');
  harness.render('/staff');
  assert.equal(harness.requests[0].options.signal.aborted, true);
  harness.requests[1].resolve([{ id: 'staff-1' }]);
  await flush();
  assert.equal(harness.render('/staff').data[0].id, 'staff-1');
  harness.requests[0].resolve([{ id: 'student-1' }]);
  await flush();
  assert.equal(harness.render('/staff').data[0].id, 'staff-1');
  const oldRefresh = harness.render('/staff').reload();
  const newRefresh = harness.render('/staff').reload();
  harness.requests[3].resolve([{ id: 'staff-2' }]);
  await newRefresh;
  harness.requests[2].resolve([{ id: 'stale-staff' }]);
  await oldRefresh;
  assert.equal(harness.render('/staff').data[0].id, 'staff-2');
  const failure = harness.render('/staff').reload();
  harness.requests[4].reject(new Error('Connection lost'));
  await failure;
  const failed = harness.render('/staff');
  assert.equal(failed.data[0].id, 'staff-2');
  assert.equal(failed.err, 'Connection lost');
  assert.equal(failed.loading, false);
  assert.ok(failed.updatedAt);
  harness.unmount();
});

test('fetch refreshes on resume, pauses interval work in background, and aborts on blur', async () => {
  const harness = createFetchHarness();
  harness.render('/dashboard', 30000);
  assert.equal(harness.timers.size, 1);
  harness.requests[0].resolve({ students: 5 });
  await flush();
  const tick = [...harness.timers.values()][0];
  harness.background(); tick();
  assert.equal(harness.requests.length, 1);
  harness.resume();
  assert.equal(harness.requests.length, 2);
  harness.requests[1].resolve({ students: 6 });
  await flush();
  assert.equal(harness.render('/dashboard', 30000).data.students, 6);
  tick();
  assert.equal(harness.requests.length, 3);
  harness.unmount();
  assert.equal(harness.requests[2].options.signal.aborted, true);
  assert.equal(harness.timers.size, 0);
  harness.resume();
  assert.equal(harness.requests.length, 3);
  harness.requests[2].resolve({ students: 999 });
  await flush();
  assert.equal(harness.render('/dashboard', 30000).data.students, 6);
});

test('form submission excludes hidden fields, persists explicit clears and prevents duplicate saves', async () => {
  const React = require('react');
  const component = () => null;
  const pending = [];
  const warnings = [];
  const received = [];
  const ui = loadUi({
    react: {
      ...React,
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => { }],
      useRef: (initial) => ({ current: initial }),
      useEffect() { },
    },
    'react-native': {
      View: component, ScrollView: component, KeyboardAvoidingView: component, Text: component,
      Platform: { OS: 'android' }, TextInput: component,
      Animated: { View: component, Value: class { interpolate() { return 0; } } },
      StyleSheet: { create: (styles) => styles },
    },
    './ResultPopup': { usePopup: () => ({ warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) }) },
  });
  const tree = ui.FormScreen({
    fields: [
      { key: 'audience', label: 'Audience' },
      { key: 'classId', label: 'Class', visibleWhen: { key: 'audience', value: 'CLASS' } },
      { key: 'batchId', label: 'Batch', required: false, emptyValue: null },
      { key: 'feeReminderDays', label: 'Reminder days', kind: 'number', min: 0, max: 30, integer: true },
      { key: 'amount', label: 'Amount', kind: 'money', min: 0.01 },
    ],
    initialValues: { audience: 'SCHOOL', classId: 'stale-class', batchId: '', feeReminderDays: '0', amount: '123.45' },
    submit: (body) => { received.push(body); return new Promise((resolve) => pending.push(resolve)); },
    onDone: (result) => received.push(result),
  });
  function findButton(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === ui.Button && node.props.label === 'Save') return node;
    for (const child of React.Children.toArray(node.props?.children)) {
      const match = findButton(child);
      if (match) return match;
    }
    return null;
  }
  const button = findButton(tree);
  assert.ok(button);
  const first = button.props.onPress();
  await button.props.onPress();
  assert.equal(received.length, 1);
  assert.equal(received[0].audience, 'SCHOOL');
  assert.equal(received[0].classId, undefined);
  assert.equal(received[0].batchId, null);
  assert.equal(received[0].feeReminderDays, 0);
  assert.equal(received[0].amount, 12345);
  pending[0]({ saved: true });
  await first;
  assert.equal(received[1].saved, true);
  assert.equal(warnings.length, 0);
});
