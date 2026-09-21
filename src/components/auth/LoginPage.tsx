import React, { useState } from 'react';
import { Container, TextInput, PasswordInput, Button, Text, Group } from '@mantine/core';
import { Link } from 'react-router-dom';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Login logic would go here
    console.log('Login attempt with:', email, password);
  };

  return (
    <Container size="sm" style={{ paddingTop: '2rem', paddingBottom: '2rem' }}>
      <Text size="h2" align="center">Login to Custodia</Text>
      
      <form onSubmit={handleSubmit}>
        <TextInput
          label="Email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          mt="md"
        />
        
        <PasswordInput
          label="Password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          mt="md"
        />
        
        <Group position="center" mt="xl">
          <Button type="submit">Login</Button>
        </Group>
      </form>
      
      <Text align="center" mt="xl">
        Don't have an account? <Link to="/">Learn more</Link>
      </Text>
    </Container>
  );
};

export default LoginPage;