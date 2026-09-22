import React from 'react';
import { AppShell } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { signOut } from 'firebase/auth';
import { auth } from '../../../services/firebase';
import ManageNavBar from './ManageNavBar';

interface ManageLayoutProps {
  children: React.ReactNode;
}

const ManageLayout: React.FC<ManageLayoutProps> = ({ children }) => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  return (
    <AppShell
      header={{ height: 60 }}
      padding="md"
    >
      <AppShell.Header>
        <ManageNavBar />
      </AppShell.Header>
      <AppShell.Main>
        {children}
      </AppShell.Main>
    </AppShell>
  );
};

export default ManageLayout;