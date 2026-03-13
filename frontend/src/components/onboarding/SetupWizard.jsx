import React, { useState } from 'react';
import SetupStepWelcome from './SetupStepWelcome';
import SetupStepModel from './SetupStepModel';
import SetupStepMessaging from './SetupStepMessaging';
import SetupStepSkills from './SetupStepSkills';
import SetupStepLaunch from './SetupStepLaunch';

/**
 * NT-ClawLaunch: Setup Wizard Orchestrator
 * Implements the "Stepper UI" design secret.
 */
const SetupWizard = ({ onFinished }) => {
  const [currentStep, setCurrentStep] = useState(0); // Start with Step 0
  const totalSteps = 5; // 0, 1, 2, 3, 4

  const nextStep = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <SetupStepWelcome onNext={nextStep} />;
      case 1:
        return <SetupStepModel onNext={nextStep} />;
      case 2:
        return <SetupStepMessaging onNext={nextStep} />;
      case 3:
        return <SetupStepSkills onNext={nextStep} />;
      case 4:
        return <SetupStepLaunch onComplete={onFinished} />;
      default:
        return <SetupStepWelcome onNext={nextStep} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfcfd] flex flex-col items-center justify-center p-6 font-sans">
      {/* 頂部進度條 (Stepper UI) */}
      <div className="w-full max-w-2xl mb-8">
        <div className="flex justify-between items-center mb-4">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            {currentStep === 0 ? '歡迎啟動' : currentStep < 4 ? `蝦窩佈置進度: ${currentStep} / ${totalSteps - 2}` : '最後啟動階段'}
          </span>
          <span className="text-xs font-bold text-blue-600">
            {Math.round(((currentStep + 1) / totalSteps) * 100)}%
          </span>
        </div>
        <div className="w-full h-1.5 bg-gray-100 rounded-full flex gap-1">
          {[0, 1, 2, 3, 4].map((step) => (
            <div 
              key={step}
              className={`h-full rounded-full transition-all duration-500 ${
                currentStep >= step ? 'bg-blue-500 flex-[1]' : 'bg-gray-200 flex-[1]'
              }`}
            ></div>
          ))}
        </div>
      </div>

      {/* 步驟內容容器 */}
      <div className="w-full transition-all duration-300">
        {renderStep()}
      </div>

      {/* 底部導航補助 */}
      {currentStep > 0 && currentStep < 4 && (
        <button 
          onClick={prevStep}
          className="mt-8 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          ← 返回上一步
        </button>
      )}

      {/* 品牌 Logo (蝦爪圖標) */}
      <div className="mt-12 flex items-center gap-2 opacity-20 grayscale">
        <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center text-white font-bold">L</div>
        <span className="font-bold text-gray-900 tracking-tighter">NT-ClawLaunch</span>
      </div>
    </div>
  );
};

export default SetupWizard;
