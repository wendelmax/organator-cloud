terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "us-east-1"
}

# Organator Cloud Base Infrastructure
# This is a starting point for users who want to host the SaaS on EC2 instead of Kubernetes.

resource "aws_instance" "organator_host" {
  ami           = "ami-0c7217cdde317cfec" # Ubuntu 22.04 LTS
  instance_type = "t3.medium"
  
  vpc_security_group_ids = [aws_security_group.organator_sg.id]
  
  user_data = <<-EOF
              #!/bin/bash
              apt-get update
              apt-get install -y docker.io docker-compose
              systemctl start docker
              systemctl enable docker
              
              # Deploy via Docker Compose automatically
              git clone https://github.com/your-org/organator.git /opt/organator
              cd /opt/organator
              docker-compose up -d
              EOF

  tags = {
    Name = "Organator-Cloud-Host"
  }
}

resource "aws_security_group" "organator_sg" {
  name        = "organator_sg"
  description = "Allow HTTP, HTTPS, and API traffic"

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
