"""
Dynamic functions for workflow variable substitution
Provides functions like randomString(), randomNumber(), uuid(), timestamp(), etc.
that can be used in {{functionName(params)}} placeholders
"""
import random
import string
import uuid
import time
from datetime import datetime, timedelta
from typing import Any, Dict
import logging

logger = logging.getLogger(__name__)


class DynamicFunctions:
    """Collection of dynamic functions for variable substitution"""
    
    @staticmethod
    def randomString(length: int = 10) -> str:
        """
        Generate a random alphanumeric string
        
        Args:
            length: Length of the random string (default: 10)
            
        Returns:
            Random string of specified length
            
        Example: {{randomString(10)}} -> "aBcD1eFg2H"
        """
        try:
            length = int(length)
            if length < 1:
                length = 10
            return ''.join(random.choices(string.ascii_letters + string.digits, k=length))
        except (ValueError, TypeError):
            logger.warning(f"Invalid length for randomString: {length}, using default 10")
            return ''.join(random.choices(string.ascii_letters + string.digits, k=10))
    
    @staticmethod
    def randomNumber(size: int = 6) -> str:
        """
        Generate a random number
        
        Args:
            size: Number of digits (default: 6)
            
        Returns:
            Random number as string
            
        Example: {{randomNumber(6)}} -> "123456"
        """
        try:
            size = int(size)
            if size < 1:
                size = 6
            max_num = int('9' * size)
            min_num = int('1' + '0' * (size - 1)) if size > 1 else 1
            return str(random.randint(min_num, max_num))
        except (ValueError, TypeError):
            logger.warning(f"Invalid size for randomNumber: {size}, using default 6")
            return str(random.randint(100000, 999999))
    
    @staticmethod
    def randomEmail() -> str:
        """
        Generate a random email address
        
        Returns:
            Random email in format: random_string@example.com
            
        Example: {{randomEmail()}} -> "aBcD1eFg2H@example.com"
        """
        random_part = DynamicFunctions.randomString(10)
        return f"{random_part}@example.com"
    
    @staticmethod
    def uuid() -> str:
        """
        Generate a UUID v4
        
        Returns:
            UUID string
            
        Example: {{uuid()}} -> "550e8400-e29b-41d4-a716-446655440000"
        """
        return str(uuid.uuid4())
    
    @staticmethod
    def timestamp() -> str:
        """
        Get current Unix timestamp
        
        Returns:
            Current Unix timestamp as string
            
        Example: {{timestamp()}} -> "1730290800"
        """
        return str(int(time.time()))
    
    @staticmethod
    def iso_timestamp() -> str:
        """
        Get current ISO 8601 timestamp
        
        Returns:
            Current timestamp in ISO format
            
        Example: {{iso_timestamp()}} -> "2025-10-30T12:00:00"
        """
        return datetime.now().isoformat()
    
    @staticmethod
    def date(format: str = "%Y-%m-%d") -> str:
        """
        Get current date in specified format
        
        Args:
            format: Date format string (default: YYYY-MM-DD)
            
        Returns:
            Formatted date string
            
        Example: {{date()}} -> "2025-10-30"
        Example: {{date(%d/%m/%Y)}} -> "30/10/2025"
        """
        try:
            return datetime.now().strftime(format)
        except (ValueError, TypeError):
            logger.warning(f"Invalid date format: {format}, using default YYYY-MM-DD")
            return datetime.now().strftime("%Y-%m-%d")
    
    @staticmethod
    def futureDate(days: int = 1, format: str = "%Y-%m-%d") -> str:
        """
        Get a future date
        
        Args:
            days: Number of days in the future (default: 1)
            format: Date format string (default: YYYY-MM-DD)
            
        Returns:
            Formatted future date string
            
        Example: {{futureDate(7)}} -> "2025-11-06"
        """
        try:
            days = int(days)
            future = datetime.now() + timedelta(days=days)
            return future.strftime(format)
        except (ValueError, TypeError):
            logger.warning(f"Invalid parameters for futureDate: days={days}, format={format}")
            future = datetime.now() + timedelta(days=1)
            return future.strftime("%Y-%m-%d")
    
    @staticmethod
    def pastDate(days: int = 1, format: str = "%Y-%m-%d") -> str:
        """
        Get a past date
        
        Args:
            days: Number of days in the past (default: 1)
            format: Date format string (default: YYYY-MM-DD)
            
        Returns:
            Formatted past date string
            
        Example: {{pastDate(7)}} -> "2025-10-23"
        """
        try:
            days = int(days)
            past = datetime.now() - timedelta(days=days)
            return past.strftime(format)
        except (ValueError, TypeError):
            logger.warning(f"Invalid parameters for pastDate: days={days}, format={format}")
            past = datetime.now() - timedelta(days=1)
            return past.strftime("%Y-%m-%d")
    
    @staticmethod
    def randomChoice(options: str) -> str:
        """
        Pick a random choice from comma-separated options
        
        Args:
            options: Comma-separated options
            
        Returns:
            One randomly selected option
            
        Example: {{randomChoice(option1,option2,option3)}} -> "option2"
        """
        try:
            opts = [opt.strip() for opt in options.split(',')]
            if opts:
                return random.choice(opts)
            return ""
        except Exception as e:
            logger.warning(f"Error in randomChoice: {e}")
            return ""
    
    @staticmethod
    def randomAlpha(length: int = 10) -> str:
        """
        Generate a random alphabetic string (letters only, no numbers)
        
        Args:
            length: Length of the random string (default: 10)
            
        Returns:
            Random alphabetic string
            
        Example: {{randomAlpha(8)}} -> "aBcDeFgH"
        """
        try:
            length = int(length)
            if length < 1:
                length = 10
            return ''.join(random.choices(string.ascii_letters, k=length))
        except (ValueError, TypeError):
            logger.warning(f"Invalid length for randomAlpha: {length}, using default 10")
            return ''.join(random.choices(string.ascii_letters, k=10))
    
    @staticmethod
    def randomNumeric(length: int = 10) -> str:
        """
        Generate a random numeric string (digits only)
        
        Args:
            length: Length of the numeric string (default: 10)
            
        Returns:
            Random numeric string
            
        Example: {{randomNumeric(6)}} -> "123456"
        """
        try:
            length = int(length)
            if length < 1:
                length = 10
            return ''.join(random.choices(string.digits, k=length))
        except (ValueError, TypeError):
            logger.warning(f"Invalid length for randomNumeric: {length}, using default 10")
            return ''.join(random.choices(string.digits, k=10))
    
    @staticmethod
    def randomHex(length: int = 16) -> str:
        """
        Generate a random hexadecimal string
        
        Args:
            length: Length of the hex string (default: 16)
            
        Returns:
            Random hexadecimal string
            
        Example: {{randomHex(8)}} -> "a1b2c3d4"
        """
        try:
            length = int(length)
            if length < 1:
                length = 16
            return ''.join(random.choices(string.hexdigits[:16], k=length)).lower()
        except (ValueError, TypeError):
            logger.warning(f"Invalid length for randomHex: {length}, using default 16")
            return ''.join(random.choices(string.hexdigits[:16], k=16)).lower()
    
    @staticmethod
    def get_function(name: str):
        """Get a function by name"""
        functions = {
            'randomString': DynamicFunctions.randomString,
            'randomNumber': DynamicFunctions.randomNumber,
            'randomEmail': DynamicFunctions.randomEmail,
            'uuid': DynamicFunctions.uuid,
            'timestamp': DynamicFunctions.timestamp,
            'iso_timestamp': DynamicFunctions.iso_timestamp,
            'date': DynamicFunctions.date,
            'futureDate': DynamicFunctions.futureDate,
            'pastDate': DynamicFunctions.pastDate,
            'randomChoice': DynamicFunctions.randomChoice,
            'randomAlpha': DynamicFunctions.randomAlpha,
            'randomNumeric': DynamicFunctions.randomNumeric,
            'randomHex': DynamicFunctions.randomHex,
        }
        return functions.get(name)
    
    @staticmethod
    def get_all_functions() -> Dict[str, str]:
        """Get documentation for all available functions"""
        return {
            'randomString(length)': 'Generate a random alphanumeric string. Default length: 10',
            'randomNumber(size)': 'Generate a random number with specified digits. Default: 6 digits',
            'randomEmail()': 'Generate a random email address',
            'uuid()': 'Generate a UUID v4',
            'timestamp()': 'Get current Unix timestamp',
            'iso_timestamp()': 'Get current ISO 8601 timestamp',
            'date(format)': 'Get current date. Default format: %Y-%m-%d',
            'futureDate(days, format)': 'Get a future date. Default: 1 day, format: %Y-%m-%d',
            'pastDate(days, format)': 'Get a past date. Default: 1 day, format: %Y-%m-%d',
            'randomChoice(options)': 'Pick random choice from comma-separated options',
            'randomAlpha(length)': 'Generate random alphabetic string (letters only). Default: 10',
            'randomNumeric(length)': 'Generate random numeric string (digits only). Default: 10',
            'randomHex(length)': 'Generate random hexadecimal string. Default: 16',
        }
