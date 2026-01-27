import React, { useState } from 'react';

/**
 * A conversational form component that collects structured user input via
 * a series of questions. Each question corresponds to a field in the
 * simulation context. The component displays a chat-like transcript
 * showing both system prompts and user responses.
 *
 * Props:
 *   onComplete: function(context) called when all questions are answered.
 */
export default function ChatPanel({ onComplete }) {
  // Steps defining the conversational flow
  const steps = [
    { key: 'ideaSummary', question: 'Please describe your idea in a couple of sentences.' },
    { key: 'country', question: 'Which country is your target market?' },
    { key: 'city', question: 'Which city?' },
    {
      key: 'targetAudience',
      question: 'Select the target audience (you can choose multiple):',
      type: 'multi-select',
      options: ['Consumers', 'Businesses', 'Non-profits', 'Government'],
    },
    {
      key: 'ideaMaturity',
      question: 'What is the maturity level of your idea?',
      type: 'radio',
      options: ['Concept', 'Prototype', 'MVP', 'Growth'],
    },
    {
      key: 'riskAppetite',
      question: 'On a scale from 0 to 1, how much risk are you willing to take?',
      type: 'slider',
      min: 0,
      max: 1,
      step: 0.1,
    },
    {
      key: 'goals',
      question: 'Select your goals (you can choose multiple):',
      type: 'multi-select',
      options: ['Profit', 'Impact', 'Innovation', 'Community'],
    },
  ];
  // State for current step index
  const [stepIndex, setStepIndex] = useState(0);
  // Collect answers keyed by step key
  const [answers, setAnswers] = useState({});
  // Chat messages (array of { sender: 'system'|'user', text: string })
  const [messages, setMessages] = useState([
    { sender: 'system', text: steps[0].question },
  ]);
  // Temporary input state for the current user input
  const [inputValue, setInputValue] = useState('');
  const currentStep = steps[stepIndex];

  // Submit handler for text, radio and slider types
  const handleSubmit = (e) => {
    e.preventDefault();
    if (currentStep.type === 'multi-select') {
      // Multi-select handled separately
      return;
    }
    // Validate non-empty for mandatory fields
    if (!inputValue && currentStep.type !== 'slider') {
      return;
    }
    // Save answer
    const value = currentStep.type === 'slider' ? parseFloat(inputValue) : inputValue;
    setAnswers((prev) => ({ ...prev, [currentStep.key]: value }));
    // Add user message
    setMessages((prev) => [...prev, { sender: 'user', text: inputValue || String(value) }]);
    setInputValue('');
    proceedToNextStep();
  };

  const proceedToNextStep = () => {
    const nextIndex = stepIndex + 1;
    if (nextIndex < steps.length) {
      setStepIndex(nextIndex);
      setMessages((prev) => [...prev, { sender: 'system', text: steps[nextIndex].question }]);
    } else {
      // Completed all steps
      if (typeof onComplete === 'function') {
        onComplete(answers);
      }
    }
  };

  // Multi-select change handler
  const handleMultiSelectChange = (option) => {
    const currentValues = answers[currentStep.key] || [];
    const newValues = currentValues.includes(option)
      ? currentValues.filter((v) => v !== option)
      : [...currentValues, option];
    setAnswers((prev) => ({ ...prev, [currentStep.key]: newValues }));
  };

  const handleMultiSelectSubmit = (e) => {
    e.preventDefault();
    const currentValues = answers[currentStep.key] || [];
    // user must choose at least one option
    if (currentValues.length === 0) return;
    setMessages((prev) => [
      ...prev,
      { sender: 'user', text: currentValues.join(', ') },
    ]);
    proceedToNextStep();
  };

  return (
    <div className="chat-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="chat-messages" style={{ flexGrow: 1, overflowY: 'auto', padding: '0.5rem' }}>
        {messages.map((msg, idx) => (
          <div key={idx} style={{ marginBottom: '0.5rem' }}>
            <strong>{msg.sender === 'system' ? 'System' : 'You'}:</strong> {msg.text}
          </div>
        ))}
      </div>
      {stepIndex < steps.length && (
        <form
          onSubmit={currentStep.type === 'multi-select' ? handleMultiSelectSubmit : handleSubmit}
          style={{ padding: '0.5rem', borderTop: '1px solid #eee' }}
        >
          {currentStep.type === 'radio' && (
            <div>
              {currentStep.options.map((opt) => (
                <label key={opt} style={{ display: 'block', marginBottom: '0.25rem' }}>
                  <input
                    type="radio"
                    name={currentStep.key}
                    value={opt}
                    checked={inputValue === opt}
                    onChange={(e) => setInputValue(e.target.value)}
                  />{' '}
                  {opt}
                </label>
              ))}
            </div>
          )}
          {currentStep.type === 'slider' && (
            <div>
              <input
                type="range"
                min={currentStep.min}
                max={currentStep.max}
                step={currentStep.step}
                value={inputValue || 0}
                onChange={(e) => setInputValue(e.target.value)}
              />
              <span style={{ marginLeft: '0.5rem' }}>{inputValue || 0}</span>
            </div>
          )}
          {currentStep.type === 'multi-select' && (
            <div>
              {currentStep.options.map((opt) => {
                const selected = (answers[currentStep.key] || []).includes(opt);
                return (
                  <label key={opt} style={{ display: 'block', marginBottom: '0.25rem' }}>
                    <input
                      type="checkbox"
                      value={opt}
                      checked={selected}
                      onChange={() => handleMultiSelectChange(opt)}
                    />{' '}
                    {opt}
                  </label>
                );
              })}
            </div>
          )}
          {(!currentStep.type || currentStep.type === 'text') && (
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              style={{ width: '100%', padding: '0.25rem' }}
            />
          )}
          <button type="submit" style={{ marginTop: '0.5rem' }}>
            {currentStep.type === 'multi-select' ? 'Next' : 'Send'}
          </button>
        </form>
      )}
    </div>
  );
}