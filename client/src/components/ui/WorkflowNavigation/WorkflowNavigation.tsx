'use client';

import React from 'react';
import { Button, Space, Progress, Tooltip, Badge } from 'antd';
import { 
    LeftOutlined, 
    RightOutlined, 
    CheckCircleOutlined, 
    ExclamationCircleOutlined,
    SaveOutlined,
    PlayCircleOutlined
} from '@ant-design/icons';

export interface WorkflowStep {
    key: string;
    title: string;
    description?: string;
    isCompleted?: boolean;
    isRequired?: boolean;
    validation?: () => boolean | Promise<boolean>;
    canSkip?: boolean;
}

export interface WorkflowNavigationProps {
    currentStep: number;
    totalSteps: number;
    steps: WorkflowStep[];
    onStepChange: (step: number) => void;
    onCancel?: () => void;
    onSave?: () => void;
    onComplete?: () => void;
    loading?: boolean;
    canProceed?: boolean;
    showProgress?: boolean;
    customActions?: React.ReactNode;
    className?: string;
}

const WorkflowNavigation: React.FC<WorkflowNavigationProps> = ({
    currentStep,
    totalSteps,
    steps,
    onStepChange,
    onCancel,
    onSave,
    onComplete,
    loading = false,
    canProceed = true,
    showProgress = true,
    customActions,
    className = ''
}) => {
    const isFirstStep = currentStep === 0;
    const isLastStep = currentStep === totalSteps - 1;
    const currentStepData = steps[currentStep];
    
    const handlePrevious = () => {
        if (currentStep > 0) {
            onStepChange(currentStep - 1);
        }
    };
    
    const handleNext = () => {
        if (currentStep < totalSteps - 1 && canProceed) {
            onStepChange(currentStep + 1);
        }
    };
    
    const handleStepClick = (stepIndex: number) => {
        // Allow navigation to completed steps or the next available step
        if (stepIndex <= currentStep || steps[stepIndex]?.isCompleted) {
            onStepChange(stepIndex);
        }
    };
    
    const getStepStatus = (stepIndex: number) => {
        if (stepIndex < currentStep) return 'finish';
        if (stepIndex === currentStep) return 'process';
        return 'wait';
    };
    
    const getStepIcon = (stepIndex: number) => {
        if (stepIndex < currentStep) {
            return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
        }
        if (stepIndex === currentStep) {
            return <PlayCircleOutlined style={{ color: '#1890ff' }} />;
        }
        return null;
    };
    
    const progressPercentage = ((currentStep + 1) / totalSteps) * 100;
    
    return (
        <div className={`workflow-navigation ${className}`}>
            {/* Progress Bar */}
            {showProgress && (
                <div style={{ marginBottom: 16 }}>
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        marginBottom: 8
                    }}>
                        <span style={{ fontSize: '14px', color: '#666' }}>
                            Step {currentStep + 1} of {totalSteps}
                        </span>
                        <span style={{ fontSize: '14px', color: '#666' }}>
                            {Math.round(progressPercentage)}% Complete
                        </span>
                    </div>
                    <Progress 
                        percent={progressPercentage} 
                        showInfo={false}
                        strokeColor={{
                            '0%': '#108ee9',
                            '100%': '#87d068',
                        }}
                    />
                </div>
            )}
            
            {/* Step Indicators */}
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                marginBottom: 24,
                flexWrap: 'wrap',
                gap: '8px'
            }}>
                {steps.map((step, index) => (
                    <Tooltip 
                        key={step.key}
                        title={`${step.title}${step.description ? `: ${step.description}` : ''}`}
                    >
                        <Button
                            type={index === currentStep ? 'primary' : 'default'}
                            size="small"
                            onClick={() => handleStepClick(index)}
                            disabled={index > currentStep && !step.isCompleted}
                            icon={getStepIcon(index)}
                            style={{
                                minWidth: '120px',
                                position: 'relative'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span>{step.title}</span>
                                {step.isCompleted && (
                                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                                )}
                                {step.isRequired && !step.isCompleted && index <= currentStep && (
                                    <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                                )}
                            </div>
                        </Button>
                    </Tooltip>
                ))}
            </div>
            
            {/* Navigation Buttons */}
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                padding: '16px 0',
                borderTop: '1px solid #f0f0f0'
            }}>
                {/* Left Side - Cancel and Previous */}
                <Space>
                    {onCancel && (
                        <Button onClick={onCancel} disabled={loading}>
                            Cancel
                        </Button>
                    )}
                    
                    {!isFirstStep && (
                        <Button 
                            icon={<LeftOutlined />}
                            onClick={handlePrevious}
                            disabled={loading}
                        >
                            Previous
                        </Button>
                    )}
                </Space>
                
                {/* Center - Custom Actions */}
                {customActions && (
                    <div style={{ flex: 1, textAlign: 'center' }}>
                        {customActions}
                    </div>
                )}
                
                {/* Right Side - Save, Next, and Complete */}
                <Space>
                    {onSave && currentStepData?.canSkip && (
                        <Button 
                            icon={<SaveOutlined />}
                            onClick={onSave}
                            loading={loading}
                        >
                            Save & Skip
                        </Button>
                    )}
                    
                    {!isLastStep && (
                        <Button 
                            type="primary"
                            icon={<RightOutlined />}
                            onClick={handleNext}
                            disabled={loading || !canProceed}
                        >
                            Next
                        </Button>
                    )}
                    
                    {isLastStep && onComplete && (
                        <Button 
                            type="primary"
                            icon={<CheckCircleOutlined />}
                            onClick={onComplete}
                            loading={loading}
                            disabled={!canProceed}
                        >
                            Complete
                        </Button>
                    )}
                </Space>
            </div>
            
            {/* Current Step Info */}
            <div style={{ 
                padding: '12px 16px', 
                backgroundColor: '#1f1f1f', 
                borderRadius: '6px',
                marginTop: '16px',
                border: '1px solid #434343'
            }}>
                <div style={{ fontWeight: 500, marginBottom: '4px', color: '#ffffff' }}>
                    {currentStepData?.title}
                </div>
                {currentStepData?.description && (
                    <div style={{ color: '#d9d9d9', fontSize: '14px' }}>
                        {currentStepData.description}
                    </div>
                )}
                {currentStepData?.isRequired && (
                    <Badge 
                        status="warning" 
                        text="Required step" 
                        style={{ marginTop: '8px', color: '#ffffff' }}
                    />
                )}
            </div>
        </div>
    );
};

export default WorkflowNavigation;
