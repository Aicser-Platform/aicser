import { Spin } from 'antd';

const LoadingScreen = () => {
    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#ffffff',
            zIndex: 9999,
        }}>
            <Spin size="large" />
        </div>
    );
};

export default LoadingScreen;
