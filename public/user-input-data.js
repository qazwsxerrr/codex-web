export const USER_INPUT_OTHER = "__codex_user_input_other__";

function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

export function normalizeUserInputQuestion(question, index = 0) {
  const options = Array.isArray(question?.options)
    ? question.options
      .map((option) => ({
        label: text(option?.label).trim(),
        description: text(option?.description).trim(),
      }))
      .filter((option) => option.label)
    : [];
  return {
    id: text(question?.id).trim() || `question-${index + 1}`,
    header: text(question?.header).trim(),
    question: text(question?.question).trim(),
    options,
    isOther: Boolean(question?.isOther),
    isSecret: Boolean(question?.isSecret),
  };
}

export function normalizeUserInputQuestions(questions) {
  return (Array.isArray(questions) ? questions : [])
    .map((question, index) => normalizeUserInputQuestion(question, index));
}

function getAnswer(answers, questionId) {
  if (answers instanceof Map) return answers.get(questionId) || null;
  return answers?.[questionId] || null;
}

export function isUserInputAnswerComplete(question, answer) {
  if (!answer || typeof answer !== "object") return false;
  if (answer.type === "option") {
    return question.options.some((option) => option.label === answer.value);
  }
  if (answer.type === "text") {
    const value = text(answer.value).trim();
    return Boolean(value) && (!question.options.length || question.isOther || question.isSecret);
  }
  return false;
}

export function countUserInputAnswers(questions, answers) {
  return questions.filter((question) => isUserInputAnswerComplete(question, getAnswer(answers, question.id))).length;
}

export function buildUserInputResult(questions, answers) {
  const result = {};
  for (const question of questions) {
    const answer = getAnswer(answers, question.id);
    if (!isUserInputAnswerComplete(question, answer)) return null;
    result[question.id] = {
      answers: [answer.type === "option" ? answer.value : `user_note: ${text(answer.value).trim()}`],
    };
  }
  return { answers: result };
}

export function persistableUserInputAnswers(questions, answers) {
  const result = {};
  for (const question of questions) {
    if (question.isSecret) continue;
    const answer = getAnswer(answers, question.id);
    if (isUserInputAnswerComplete(question, answer)) result[question.id] = { ...answer };
  }
  return result;
}

export function resetUserInputRequest(request) {
  request?.answers?.clear?.();
  return null;
}
