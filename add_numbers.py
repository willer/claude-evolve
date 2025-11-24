def add_numbers(a, b):
    """
    Add two numbers together.
    
    Args:
        a (int or float): The first number
        b (int or float): The second number
    
    Returns:
        int or float: The sum of the two numbers
    """
    return a + b

# Example usage
if __name__ == "__main__":
    # Test the function with different types of numbers
    print(f"5 + 3 = {add_numbers(5, 3)}")
    print(f"2.5 + 1.7 = {add_numbers(2.5, 1.7)}")
    print(f"-10 + 15 = {add_numbers(-10, 15)}")