// TODO: Refactor setup wizard with complete type definitions
// onboarding component has incomplete types, resolvable with proper auth/config typings
import React, { useEffect, useRef, useState } from 'react';
import SetupStepWelcome from './SetupStepWelcome';
import SetupStepModel from './SetupStepModel';
import SetupStepMessaging from './SetupStepMessaging';
import SetupStepSkills from './SetupStepSkills';
import SetupStepLaunch from './SetupStepLaunch';
import SetupStepInitialize from './SetupStepInitialize';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '../LanguageToggle';
import { useStore } from '../../store';

type SetupWizardProps = {
  onFinished: () => void;
};

type StepId = 'welcome' | 'initialize' | 'model' | 'messaging' | 'skills' | 'launch';

type StepDefinition = {
  id: StepId;
  component: React.ComponentType<any>;
};

/**
 * NT-ClawLaunch: Setup Wizard Orchestrator
 * Implements the "Stepper UI" design secret.
 */
const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;

const SetupWizard = ({ onFinished }: SetupWizardProps) => {
  const { userType, config } = useStore();
  const [currentStep, setCurrentStep] = useState(0); // Start with Step 0
  const { t } = useTranslation();
  const completedRef = useRef(false);
  const latestConfigRef = useRef(config);

  useEffect(() => {
    latestConfigRef.current = config;
  }, [config]);

  useEffect(() => {
    const stopOnboardingRuntime = () => {
      if (completedRef.current || !window.electronAPI) return;

      const latestConfig = latestConfigRef.current;

      window.electronAPI.exec('process:kill-all').catch(() => {});

      const stateDirEnv = latestConfig.workspacePath ? `OPENCLAW_STATE_DIR=${shellQuote(latestConfig.workspacePath)} ` : '';
      const configPathEnv = latestConfig.configPath ? `OPENCLAW_CONFIG_PATH=${shellQuote(latestConfig.configPath + '/openclaw.json')} ` : '';
      const envPrefix = `${stateDirEnv}${configPathEnv}`;
      const stopCmd = latestConfig.corePath
        ? `cd ${shellQuote(latestConfig.corePath)} && ${envPrefix}(pnpm openclaw gateway stop || openclaw gateway stop)`
        : `${envPrefix}(pnpm openclaw gateway stop || openclaw gateway stop)`;

      window.electronAPI.exec(stopCmd).catch(() => {});
    };

    window.addEventListener('beforeunload', stopOnboardingRuntime);

    return () => {
      window.removeEventListener('beforeunload', stopOnboardingRuntime);
      stopOnboardingRuntime();
    };
  }, []);

  // Define dynamic step paths
  const steps: StepDefinition[] = [
    { id: 'welcome', component: SetupStepWelcome },
    ...(userType === 'new' ? ([{ id: 'initialize', component: SetupStepInitialize }] as StepDefinition[]) : []),
    { id: 'model', component: SetupStepModel },
    { id: 'messaging', component: SetupStepMessaging },
    { id: 'skills', component: SetupStepSkills },
    { id: 'launch', component: SetupStepLaunch },
  ];

  const totalSteps = steps.length;
  const setupStepIds: ('initialize' | 'model' | 'messaging' | 'skills')[] = steps
    .map((step) => step.id)
    .filter((id): id is 'initialize' | 'model' | 'messaging' | 'skills' => id !== 'welcome' && id !== 'launch');
  const currentStepId: StepId | undefined = steps[currentStep]?.id;
  const currentSetupStepId =
    currentStepId === 'initialize' || currentStepId === 'model' || currentStepId === 'messaging' || currentStepId === 'skills'
      ? currentStepId
      : null;
  const setupStageTotal = Math.max(setupStepIds.length, 1);
  const setupStageCurrent = Math.max(currentSetupStepId ? setupStepIds.indexOf(currentSetupStepId) : 0, 0);

  const nextStep = () => {
    setCurrentStep((prev) => (prev < totalSteps - 1 ? prev + 1 : prev));
  };

  const prevStep = () => {
    setCurrentStep((prev) => (prev > 0 ? prev - 1 : prev));
  };

  const renderStep = () => {
    const activeStep = steps[currentStep];
    const StepComponent = activeStep.component;
    if (activeStep.id === 'launch') {
        return <StepComponent onComplete={() => {
          completedRef.current = true;
          onFinished();
        }} />;
    }
    return <StepComponent onNext={nextStep} />;
  };

  return (
    <div className="h-screen bg-[#fcfcfd] flex flex-col items-center overflow-y-auto p-6 font-sans">
      <div className="w-full max-w-2xl flex flex-col my-auto">
      {/* Top progress bar (Stepper UI) */}
      <div className="w-full mb-8">
        <div className="flex justify-between items-center mb-4">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            {currentStep === 0
              ? t('wizard.steps.welcome')
              : currentStep < totalSteps - 1
                ? t('wizard.steps.progress', { current: setupStageCurrent + 1, total: setupStageTotal })
                : t('wizard.steps.launch')}
          </span>
          <span className="text-xs font-bold text-blue-600">
            {Math.round(((currentStep + 1) / totalSteps) * 100)}%
          </span>
        </div>
        <div className="w-full h-1.5 bg-gray-100 rounded-full flex gap-1">
          {steps.map((_, index) => (
            <div 
              key={index}
              className={`h-full rounded-full transition-all duration-500 ${
                currentStep >= index ? 'bg-blue-500 flex-[1]' : 'bg-gray-200 flex-[1]'
              }`}
            ></div>
          ))}
        </div>
      </div>

      {/* Step content container */}
      <div className="w-full transition-all duration-300">
        {renderStep()}
      </div>

      {/* Bottom navigation helper */}
      {currentStep > 0 && currentStep < totalSteps - 1 && (
        <button 
          onClick={prevStep}
          className="mt-8 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          {t('wizard.backBtn')}
        </button>
      )}

      {/* Brand Logo (Claw icon) */}
      <div className="mt-12 flex items-center gap-4">
        <LanguageToggle />
        <div className="flex items-center gap-2 opacity-20 grayscale">
          <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center text-white font-bold">{t('wizard.brand.mark')}</div>
          <span className="font-bold text-gray-900 tracking-tighter">{t('wizard.brand.name')}</span>
        </div>
      </div>
      </div>{/* end my-auto wrapper */}
    </div>
  );
};

export default SetupWizard;
